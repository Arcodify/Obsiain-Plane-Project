import { Editor, Events, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { PlaneClient } from "./planeClient";
import { DEFAULT_SETTINGS, PlaneSettingTab, PlaneSettings } from "./settings";
import type {
	PlaneCache,
	PersistedData,
	PlaneWorkItem,
	ProjectCache,
	PlaneProject,
} from "./types";
import { PlaneHubModal } from "./ui/hub";
import { PlaneBoardView, VIEW_TYPE_PLANE_BOARD } from "./ui/boardView";

export default class PlaneProjectPlugin extends Plugin {
	settings: PlaneSettings = DEFAULT_SETTINGS;
	cache: PlaneCache = { projects: {}, selectedProjectId: undefined };
	client: PlaneClient = new PlaneClient(() => this.settings);
	availableProjects: PlaneProject[] = [];
	events = new Events();

	async onload() {
		await this.loadPersisted();

		this.addRibbonIcon("paper-plane", "Open plane hub", () => this.openHub());
		this.addRibbonIcon("layout-kanban", "Open plane board", () => this.openBoardForProject());

		this.addCommand({
			id: "plane-open-hub",
			name: "Plane: open hub",
			callback: () => this.openHub(),
		});

		this.addCommand({
			id: "plane-open-board",
			name: "Plane: open project board",
			callback: () => this.openBoardForProject(),
		});

		this.addCommand({
			id: "plane-sync",
			name: "Plane: sync modules and work items",
			callback: () => this.syncFromPlane(true),
		});

		this.addCommand({
			id: "plane-new-from-selection",
			name: "Plane: create work item from selection",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const title = editor.getSelection() || view.file?.basename || "Untitled";
				await this.createWorkItemFromText(title, editor.getSelection());
			},
		});

		this.addCommand({
			id: "plane-push-note",
			name: "Plane: push current note to work item description",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const meta = this.app.metadataCache.getFileCache(file);
				const planeId = meta?.frontmatter?.planeId as string | undefined;
				if (!planeId) return false;
				if (!checking) void this.pushNoteToPlane(file, planeId);
				return true;
			},
		});

		this.addSettingTab(new PlaneSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_PLANE_BOARD, (leaf) => new PlaneBoardView(leaf, this));

		if (this.settings.syncOnLoad) {
			void this.syncFromPlane(false);
		}
	}

	onunload() {
		// nothing to clean explicitly; all listeners are registered via helpers
	}

	async loadPersisted(): Promise<void> {
		const raw = (await this.loadData()) as PersistedData | null;
		if (raw?.settings && typeof raw.settings === "object") {
			this.settings = { ...DEFAULT_SETTINGS, ...(raw.settings as Partial<PlaneSettings>) };
		} else {
			this.settings = { ...DEFAULT_SETTINGS };
		}
		if (raw?.cache) {
			this.cache = raw.cache;
		}
		if (!this.cache.projects) this.cache = { projects: {}, selectedProjectId: this.cache.selectedProjectId };

		// pull initial project list for dropdowns
		await this.refreshProjectsList();
	}

	async savePersisted(): Promise<void> {
		await this.saveData({ settings: this.settings, cache: this.cache });
	}

	async testConnection(): Promise<boolean> {
		try {
			return await this.client.ping();
		} catch (error) {
			new Notice(String(error));
			return false;
		}
	}

	async syncFromPlane(showNotice = true, projectId?: string): Promise<void> {
		if (!this.settings.apiKey || !this.settings.workspaceSlug) {
			new Notice("Plane settings are incomplete.");
			return;
		}
		const activeProject = projectId ?? this.cache.selectedProjectId ?? this.settings.defaultProjectId;
		if (!activeProject) {
			new Notice("Choose a project in settings or hub first.");
			return;
		}

		try {
			const [modules, states] = await Promise.all([
				this.client.listModules(activeProject),
				this.client.listStates(activeProject),
			]);

			// fetch items per module so module id is present; also collect unassigned
			const perModuleItems = await Promise.all(
				modules.map(async (m) => {
					const items = await this.client.listWorkItems(activeProject, m.id);
					return items.map((it) => ({ ...it, module: m.id }));
				}),
			);
			const unassigned = await this.client.listWorkItems(activeProject, undefined);
			const workItems = [...unassigned, ...perModuleItems.flat()];

			const normalized = workItems.map((w) => this.normalizeWorkItem(w));
			this.cache.projects[activeProject] = {
				modules,
				workItems: normalized,
				states,
				lastSync: Date.now(),
			};
			this.cache.selectedProjectId = activeProject;
			await this.savePersisted();
			this.events.trigger("cache-updated");
			if (showNotice) {
				new Notice(
					`Plane synced (${this.projectLabel(activeProject)}): ${modules.length} modules, ${workItems.length} work items`,
				);
			}
		} catch (error) {
			new Notice(`Plane sync failed: ${String(error)}`);
		}
	}

	openHub(): void {
		new PlaneHubModal(this.app, this).open();
	}

	async openBoardForProject(projectId?: string): Promise<void> {
		const activeProject =
			projectId ?? this.cache.selectedProjectId ?? this.settings.defaultProjectId ?? this.availableProjects[0]?.id;
		if (!activeProject) {
			new Notice("Select a project first (settings or hub).");
			return;
		}
		await this.ensureProjectLoaded(activeProject);
		const leaf = this.getBoardLeaf();
		await leaf.setViewState({
			type: VIEW_TYPE_PLANE_BOARD,
			active: true,
			state: { projectId: activeProject },
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	async upsertWorkItem(
		item: Partial<PlaneWorkItem> & { name: string },
		existingId?: string,
		projectId?: string,
	): Promise<PlaneWorkItem> {
		const activeProject = projectId ?? item.project_id ?? this.cache.selectedProjectId ?? this.settings.defaultProjectId;
		if (!activeProject) throw new Error("No project selected");
		const moduleId = this.extractId(item.module) ?? item.module_id ?? null;
		const payload = {
			name: item.name,
			description_html: item.description_html ?? null,
			state: item.state ?? item.state_id ?? null,
			priority: item.priority ?? null,
			module: moduleId,
		};

		const saved = existingId
			? await this.client.updateWorkItem(existingId, payload, activeProject)
			: await this.client.createWorkItem(payload, activeProject);

		const projectCache = this.ensureProjectCache(activeProject);
		projectCache.workItems = this.upsertCached(
			projectCache.workItems,
			this.normalizeWorkItem(saved),
		);
		await this.savePersisted();
		this.events.trigger("cache-updated");
		return saved;
	}

	async upsertModule(
		module: { name: string; description?: string | null; status?: string | null; start_date?: string | null; target_date?: string | null },
		existingId?: string,
		projectId?: string,
	) {
		const activeProject = projectId ?? this.cache.selectedProjectId ?? this.settings.defaultProjectId;
		if (!activeProject) throw new Error("No project selected");
		const payload = {
			name: module.name,
			description: module.description ?? null,
			status: module.status ?? null,
			start_date: module.start_date ?? null,
			target_date: module.target_date ?? null,
		};

		const saved = existingId
			? await this.client.updateModule(existingId, payload, activeProject)
			: await this.client.createModule(payload, activeProject);

		const projectCache = this.ensureProjectCache(activeProject);
		projectCache.modules = this.upsertCached(
			projectCache.modules,
			saved,
		);
		await this.savePersisted();
		this.events.trigger("cache-updated");
		return saved;
	}

	async ensureNoteForWorkItem(item: PlaneWorkItem): Promise<TFile> {
		const folder = this.settings.noteFolder || "Plane";
		const folderExists = await this.app.vault.adapter.exists(folder);
		if (!folderExists) {
			await this.app.vault.createFolder(folder);
		}
		const slug = item.identifier ? item.identifier.toLowerCase() : item.id.slice(0, 8);
		const path = `${folder}/${slug}.md`;
		if (await this.app.vault.adapter.exists(path)) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) return file;
		}
		const frontmatter = [
			"---",
			`planeId: ${item.id}`,
			`planeProject: ${item.project_id}`,
			`planeModule: ${item.module ?? ""}`,
			`lastPlaneSync: ${new Date().toISOString()}`,
			"---",
			`# ${item.name}`,
			"",
			item.description_stripped ?? "",
		].join("\n");
		const file = await this.app.vault.create(path, frontmatter);
		return file;
	}

	private upsertCached<T extends { id: string }>(list: T[], item: T): T[] {
		const index = list.findIndex((x) => x.id === item.id);
		if (index === -1) return [...list, item];
		const copy = [...list];
		copy[index] = item;
		return copy;
	}

	private async createWorkItemFromText(title: string, body?: string): Promise<void> {
		try {
			const saved = await this.upsertWorkItem({
				name: title,
				description_html: body ? `<p>${body}</p>` : null,
				module: this.settings.defaultModuleId || null,
			});
			new Notice(`Created Plane work item ${saved.name}`);
		} catch (error) {
			new Notice(`Plane create failed: ${String(error)}`);
		}
	}

	private async pushNoteToPlane(file: TFile, planeId: string): Promise<void> {
		const content = await this.app.vault.read(file);
		try {
			const saved = await this.client.updateWorkItem(planeId, {
				name: file.basename,
				description_html: content,
			}, this.cache.selectedProjectId ?? this.settings.defaultProjectId);
			const projectCache = this.ensureProjectCache(saved.project_id);
			projectCache.workItems = this.upsertCached(
				projectCache.workItems,
				this.normalizeWorkItem(saved),
			);
			await this.savePersisted();
			this.events.trigger("cache-updated");
			new Notice("Plane work item updated from note");
		} catch (error) {
			new Notice(`Failed to push note: ${String(error)}`);
		}
	}

	normalizeWorkItem(item: PlaneWorkItem): PlaneWorkItem {
		const moduleId = this.extractId(item.module) ?? this.extractId((item as unknown as { module_id?: unknown }).module_id);
		const stateId = this.extractId(item.state) ?? item.state_id ?? (typeof item.state === "string" ? item.state : null);
		return {
			...item,
			module: moduleId ?? null,
			state_id: stateId ?? null,
			state: stateId ?? null,
		};
	}

	private extractId(value: unknown): string | null {
		if (typeof value === "string") return value;
		if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") {
			return (value as { id: string }).id;
		}
		return null;
	}

	getProjectCache(projectId?: string): ProjectCache | undefined {
		const activeProject = projectId ?? this.cache.selectedProjectId ?? this.settings.defaultProjectId;
		if (!activeProject) return undefined;
		return this.cache.projects[activeProject];
	}

	getProjectDataOrEmpty(projectId?: string): ProjectCache {
		return (
			this.getProjectCache(projectId) ?? {
				modules: [],
				workItems: [],
				states: [],
			}
		);
	}

	async refreshProjectsList(): Promise<void> {
		try {
			this.availableProjects = await this.client.listProjects();
			if (!this.cache.selectedProjectId) {
				this.cache.selectedProjectId =
					this.settings.defaultProjectId || this.availableProjects[0]?.id || undefined;
			}
			await this.savePersisted();
			this.events.trigger("cache-updated");
		} catch {
			// ignore; may be offline or unauthorized
		}
	}

	projectLabel(id: string): string {
		const match = this.availableProjects.find((p) => p.id === id);
		return match ? `${match.name}${match.identifier ? ` (${match.identifier})` : ""}` : id;
	}

	ensureProjectCache(projectId: string): ProjectCache {
		if (!this.cache.projects[projectId]) {
			this.cache.projects[projectId] = { modules: [], workItems: [], states: [] };
		}
		return this.cache.projects[projectId];
	}

	async ensureProjectLoaded(projectId: string): Promise<void> {
		if (!this.cache.projects[projectId] || !this.cache.projects[projectId].workItems.length) {
			await this.syncFromPlane(false, projectId);
		}
	}

	private getBoardLeaf(): WorkspaceLeaf {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PLANE_BOARD);
		if (existing.length) return existing[0]!;
		const right = this.app.workspace.getRightLeaf(false);
		if (right) return right;
		return this.app.workspace.getLeaf(true);
	}
}
