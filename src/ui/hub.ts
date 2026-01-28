import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
	TextComponent,
} from "obsidian";
import type PlaneProjectPlugin from "../main";
import type { PlaneModule, PlaneWorkItem, PlaneState } from "../types";

export class PlaneHubModal extends Modal {
	private moduleFilter: string | undefined;

	constructor(app: App, private readonly plugin: PlaneProjectPlugin) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("plane-hub");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({ cls: "plane-hub__header" });
		header.createEl("h2", { text: "Plane workspace" });

		const right = header.createDiv({ cls: "plane-hub__actions" });
		const projectSelect = new DropdownComponent(right);
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
			this.render();
		});

		const syncButton = new ButtonComponent(right);
		syncButton.setButtonText("Sync now").onClick(() => {
			void (async () => {
				syncButton.setDisabled(true).setButtonText("Syncing…");
				await this.plugin.syncFromPlane(false);
				syncButton.setDisabled(false).setButtonText("Sync now");
				this.render();
			})();
		});
		const last = header.createSpan({
			text: this.currentCache().lastSync
				? `Last sync: ${new Date(this.currentCache().lastSync!).toLocaleString()}`
				: "Not synced yet",
			cls: "plane-hub__muted",
		});
		right.appendChild(last);

		this.renderFilters(contentEl);
		this.renderModulesSection(contentEl);
		this.renderKanbanSection(contentEl);
	}

	private renderFilters(container: HTMLElement): void {
		const row = container.createDiv({ cls: "plane-hub__filters plane-hub__row" });
		row.createEl("span", { text: "Filter module", cls: "plane-hub__muted" });
		const dropdown = new DropdownComponent(row);
		dropdown.addOption("", "All modules");
		for (const mod of this.currentCache().modules) {
			dropdown.addOption(mod.id, mod.name);
		}
		dropdown.setValue(this.moduleFilter ?? "");
		dropdown.onChange((value) => {
			this.moduleFilter = value || undefined;
			this.render();
		});
	}

	private renderModulesSection(container: HTMLElement): void {
		const section = container.createDiv({ cls: "plane-hub__section" });
		const titleRow = section.createDiv({ cls: "plane-hub__row" });
		titleRow.createEl("h3", { text: "Modules" });
		const newBtn = new ButtonComponent(titleRow);
		newBtn.setButtonText("New module").onClick(() => this.openModuleForm());

		if (!this.currentCache().modules.length) {
			section.createSpan({ text: "No modules yet. Sync or create one." });
			return;
		}

		const list = section.createDiv({ cls: "plane-hub__list" });
		for (const mod of this.currentCache().modules) {
			const card = list.createDiv({ cls: "plane-hub__card" });
			card.createEl("div", { text: mod.name, cls: "plane-hub__card-title" });
			const meta = card.createDiv({ cls: "plane-hub__card-meta" });
			if (mod.status) meta.createSpan({ text: mod.status });
			if (mod.target_date) meta.createSpan({ text: `Target ${mod.target_date}` });
			const action = new ButtonComponent(card);
			action.setButtonText("Edit").onClick(() => this.openModuleForm(mod));
		}
	}

	private renderKanbanSection(container: HTMLElement): void {
		const section = container.createDiv({ cls: "plane-hub__section" });
		const titleRow = section.createDiv({ cls: "plane-hub__row" });
		titleRow.createEl("h3", { text: "Work items (kanban)" });
		const newBtn = new ButtonComponent(titleRow);
		newBtn.setButtonText("New work item").onClick(() => this.openWorkItemForm());

		const items = this.filteredItems();
		if (!items.length) {
			section.createSpan({ text: "No work items yet. Sync or create one." });
			return;
		}

		const columns = this.buildColumns(items, this.currentCache().states);
		const board = section.createDiv({ cls: "plane-board" });
		for (const column of columns) {
			const colEl = board.createDiv({ cls: "plane-board__column" });
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
				new ButtonComponent(actions).setButtonText("Edit").onClick(() => this.openWorkItemForm(item));
				new ButtonComponent(actions)
					.setButtonText("Note")
					.onClick(() => {
						void (async () => {
							const file = await this.plugin.ensureNoteForWorkItem(item);
							const leaf = this.app.workspace.getLeaf(true);
							await leaf.openFile(file);
						})();
					});
			}
		}
	}

	private buildColumns(items: PlaneWorkItem[], states: PlaneState[]) {
		const stateMap = new Map<string, PlaneState>();
		for (const s of states) stateMap.set(s.id, s);
		const grouped = new Map<string, { title: string; items: PlaneWorkItem[] }>();

		for (const item of items) {
			const state = item.state_id ?? item.state ?? "unspecified";
			const stateInfo = stateMap.get(state);
			const title = stateInfo?.name ?? "Unspecified";
			if (!grouped.has(state)) grouped.set(state, { title, items: [] });
			grouped.get(state)!.items.push(item);
		}

		return Array.from(grouped.values());
	}

	private filteredItems(): PlaneWorkItem[] {
		const data = this.currentCache();
		return data.workItems.filter((item) => {
			const modId = item.module ?? item.module_id ?? null;
			if (this.moduleFilter && modId !== this.moduleFilter) return false;
			return true;
		});
	}

	private moduleName(id: string): string {
		const mod = this.currentCache().modules.find((m) => m.id === id);
		return mod?.name ?? id;
	}

	private openWorkItemForm(item?: PlaneWorkItem): void {
		const modal = new Modal(this.app);
		modal.titleEl.setText(item ? "Edit work item" : "New work item");
		const name = new TextComponent(modal.contentEl);
		name.inputEl.addClass("plane-input");
		name.setPlaceholder("Title").setValue(item?.name ?? "");

		const description = new TextAreaComponent(modal.contentEl);
		description.inputEl.rows = 6;
		description.inputEl.addClass("plane-input");
		description.setPlaceholder("Description").setValue(item?.description_html ?? "");

		let moduleDropdown: DropdownComponent | undefined;
		new Setting(modal.contentEl)
			.setName("Module")
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("", "None");
				for (const mod of this.currentCache().modules) {
					dropdown.addOption(mod.id, mod.name);
				}
				dropdown.setValue(item?.module ?? this.moduleFilter ?? "");
				moduleDropdown = dropdown;
			});

			let priorityDropdown: DropdownComponent | undefined;
		new Setting(modal.contentEl)
			.setName("Priority")
			.addDropdown((dropdown: DropdownComponent) => {
				const options: Record<string, string> = {
					"": "none",
					low: "low",
					medium: "medium",
					high: "high",
					urgent: "urgent",
				};
				for (const [value, label] of Object.entries(options)) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(item?.priority ?? "");
				priorityDropdown = dropdown;
			});

		const buttons = modal.contentEl.createDiv({ cls: "plane-hub__row" });
		const save = new ButtonComponent(buttons);
		save.setButtonText(item ? "Save changes" : "Create");
		save.onClick(() => {
			const nameValue = name.getValue().trim();
			if (!nameValue) {
				new Notice("Name is required");
				return;
			}
			save.setDisabled(true).setButtonText("Saving…");
			void this.plugin
				.upsertWorkItem(
					{
						...item,
						name: nameValue,
						description_html: description.getValue(),
						module: moduleDropdown?.getValue() || null,
						priority: priorityDropdown?.getValue() || null,
						project_id: this.plugin.cache.selectedProjectId,
					},
					item?.id,
					this.plugin.cache.selectedProjectId,
				)
				.then(() => {
					new Notice("Saved");
					modal.close();
					this.render();
				})
				.catch((error) => {
					new Notice(String(error));
					save.setDisabled(false).setButtonText("Save");
				});
		});

		modal.open();
	}

	private openModuleForm(mod?: PlaneModule): void {
		const modal = new Modal(this.app);
		modal.titleEl.setText(mod ? "Edit module" : "New module");

		const name = new TextComponent(modal.contentEl);
		name.inputEl.addClass("plane-input");
		name.setPlaceholder("Module name").setValue(mod?.name ?? "");

		const status = new TextComponent(modal.contentEl);
		status.inputEl.addClass("plane-input");
			status.setPlaceholder("Status (planned or active)").setValue(mod?.status ?? "");

		const description = new TextAreaComponent(modal.contentEl);
		description.inputEl.rows = 4;
		description.inputEl.addClass("plane-input");
		description.setPlaceholder("Description").setValue(mod?.description ?? "");

		const buttons = modal.contentEl.createDiv({ cls: "plane-hub__row" });
		const save = new ButtonComponent(buttons);
		save.setButtonText(mod ? "Save changes" : "Create module");
		save.onClick(() => {
			const nameValue = name.getValue().trim();
			if (!nameValue) {
				new Notice("Name is required");
				return;
			}
			save.setDisabled(true).setButtonText("Saving…");
			void this.plugin
				.upsertModule(
					{
						name: nameValue,
						status: status.getValue().trim() || null,
						description: description.getValue(),
					},
					mod?.id,
					this.plugin.cache.selectedProjectId,
				)
				.then(() => {
					new Notice("Saved");
					modal.close();
					this.render();
				})
				.catch((error) => {
					new Notice(String(error));
					save.setDisabled(false).setButtonText("Save");
				});
		});

		modal.open();
	}

	private currentCache() {
		return this.plugin.getProjectDataOrEmpty();
	}
}
