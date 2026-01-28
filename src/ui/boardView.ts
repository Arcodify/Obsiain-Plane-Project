import { ItemView, DropdownComponent, ButtonComponent, type ViewStateResult } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type PlaneProjectPlugin from "../main";
import type { PlaneState, PlaneWorkItem } from "../types";

export const VIEW_TYPE_PLANE_BOARD = "plane-project-board";

interface BoardViewState {
	projectId?: string;
}

export class PlaneBoardView extends ItemView {
	private moduleFilter: string | undefined;
	private readonly onCache = () => this.render();

	constructor(leaf: WorkspaceLeaf, private readonly plugin: PlaneProjectPlugin) {
		super(leaf);
		this.registerEvent(this.plugin.events.on("cache-updated", this.onCache));
	}

	getViewType(): string {
		return VIEW_TYPE_PLANE_BOARD;
	}

	getIcon(): string {
		return "layout-grid";
	}

	getDisplayText(): string {
		const project = this.plugin.projectLabel(this.plugin.cache.selectedProjectId ?? "");
		return project ? `Plane Board: ${project}` : "Plane Board";
	}

	async setState(state: BoardViewState, result: ViewStateResult): Promise<void> {
		if (state.projectId) {
			this.plugin.cache.selectedProjectId = state.projectId;
			await this.plugin.savePersisted();
			await this.plugin.ensureProjectLoaded(state.projectId);
		}
		return super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		await this.plugin.refreshProjectsList();
		this.render();
	}

	async onClose(): Promise<void> {
		this.plugin.events.off("cache-updated", this.onCache);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("plane-hub");

		const header = contentEl.createDiv({ cls: "plane-hub__header" });
		header.createEl("h2", { text: "Plane project board" });

		const actions = header.createDiv({ cls: "plane-hub__actions" });
		const projectSelect = new DropdownComponent(actions);
		projectSelect.addOption("", "Select project");
		for (const proj of this.plugin.availableProjects) {
			projectSelect.addOption(proj.id, this.plugin.projectLabel(proj.id));
		}
		projectSelect.setValue(this.plugin.cache.selectedProjectId ?? this.plugin.settings.defaultProjectId ?? "");
		projectSelect.onChange(async (value) => {
			if (!value) return;
			this.plugin.cache.selectedProjectId = value;
			await this.plugin.savePersisted();
			await this.plugin.syncFromPlane(false, value);
		});

		const syncBtn = new ButtonComponent(actions);
		syncBtn.setButtonText("Sync").onClick(async () => {
			syncBtn.setDisabled(true).setButtonText("Syncing…");
			await this.plugin.syncFromPlane(false);
			syncBtn.setDisabled(false).setButtonText("Sync");
		});

		this.renderFilters(contentEl);
		this.renderKanban(contentEl);
	}

	private renderFilters(container: HTMLElement): void {
		const row = container.createDiv({ cls: "plane-hub__filters plane-hub__row" });
		row.createEl("span", { text: "Filter module", cls: "plane-hub__muted" });
		const dropdown = new DropdownComponent(row);
		dropdown.addOption("", "All modules");
		for (const mod of this.plugin.getProjectDataOrEmpty().modules) {
			dropdown.addOption(mod.id, mod.name);
		}
		dropdown.setValue(this.moduleFilter ?? "");
		dropdown.onChange((value) => {
			this.moduleFilter = value || undefined;
			this.render();
		});
	}

	private renderKanban(container: HTMLElement): void {
		const section = container.createDiv({ cls: "plane-hub__section" });
		const titleRow = section.createDiv({ cls: "plane-hub__row" });
		titleRow.createEl("h3", { text: "Work items" });
		new ButtonComponent(titleRow).setButtonText("New").onClick(() => this.plugin.openHub()); // reuse hub form

		const data = this.filteredItems();
		if (!data.length) {
			section.createSpan({ text: "No work items. Sync or create one." });
			return;
		}

		const columns = this.buildColumns(data, this.plugin.getProjectDataOrEmpty().states);
		const board = section.createDiv({ cls: "plane-board" });
		for (const column of columns) {
			const colEl = board.createDiv({ cls: "plane-board__column" });
			if (column.color) {
				colEl.style.background = this.dimColor(column.color, 0.08);
				colEl.style.borderColor = this.dimColor(column.color, 0.2);
			}
			const head = colEl.createDiv({ cls: "plane-board__column-head" });
			head.createEl("span", { text: column.title });
			head.createEl("span", { text: `${column.items.length}`, cls: "plane-hub__muted" });

			for (const item of column.items) {
				const card = colEl.createDiv({ cls: "plane-board__card" });
				card.createEl("div", { text: item.name, cls: "plane-hub__card-title" });
				const meta = card.createDiv({ cls: "plane-hub__card-meta" });
				if (item.identifier) meta.createSpan({ text: item.identifier, cls: "plane-hub__pill" });
				if (item.priority) meta.createSpan({ text: item.priority });
				const modId = item.module ?? item.module_id ?? null;
				if (modId) meta.createSpan({ text: this.moduleName(modId) });

				const actions = card.createDiv({ cls: "plane-hub__row" });
				new ButtonComponent(actions).setButtonText("Edit").onClick(() => this.plugin.openHub());
				new ButtonComponent(actions)
					.setButtonText("Note")
					.onClick(async () => {
						const file = await this.plugin.ensureNoteForWorkItem(item);
						const leaf = this.app.workspace.getLeaf(true);
						await leaf.openFile(file);
					});
			}
		}
	}

	private buildColumns(items: PlaneWorkItem[], states: PlaneState[]) {
		const stateMap = new Map<string, PlaneState>();
		for (const s of states) stateMap.set(s.id, s);
		const grouped = new Map<string, { title: string; items: PlaneWorkItem[]; color?: string }>();

		for (const item of items) {
			const state = item.state_id ?? item.state ?? "unspecified";
			const stateInfo = stateMap.get(state);
			const title = stateInfo?.name ?? "Unspecified";
			if (!grouped.has(state)) grouped.set(state, { title, items: [], color: stateInfo?.color });
			grouped.get(state)!.items.push(item);
		}

		return Array.from(grouped.values());
	}

	private filteredItems(): PlaneWorkItem[] {
		const data = this.plugin.getProjectDataOrEmpty();
		return data.workItems.filter((item) => {
			const modId = item.module ?? item.module_id ?? null;
			if (this.moduleFilter && modId !== this.moduleFilter) return false;
			return true;
		});
	}

	private moduleName(id: string): string {
		const mod = this.plugin.getProjectDataOrEmpty().modules.find((m) => m.id === id);
		return mod?.name ?? id;
	}

	private dimColor(hex: string, alpha: number): string {
		const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
		if (normalized.length !== 6) return `rgba(120,120,120,${alpha})`;
		const r = parseInt(normalized.slice(0, 2), 16);
		const g = parseInt(normalized.slice(2, 4), 16);
		const b = parseInt(normalized.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
}
