import { App, ButtonComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type PlaneProjectPlugin from "./main";

export interface PlaneSettings {
	apiBaseUrl: string;
	apiKey: string;
	workspaceSlug: string;
	defaultProjectId: string;
	defaultModuleId?: string;
	syncOnLoad: boolean;
	noteFolder: string;
}

export const DEFAULT_SETTINGS: PlaneSettings = {
	apiBaseUrl: "https://api.plane.so",
	apiKey: "",
	workspaceSlug: "",
	defaultProjectId: "",
	defaultModuleId: "",
	syncOnLoad: true,
	noteFolder: "Plane",
};

export class PlaneSettingTab extends PluginSettingTab {
	plugin: PlaneProjectPlugin;

	constructor(app: App, plugin: PlaneProjectPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

			new Setting(containerEl).setName("Plane connection").setHeading();

			new Setting(containerEl)
				.setName("API base URL")
				.setDesc("Your plane instance base URL. Keep the default for cloud (https://api.plane.so).")
				.addText((text) =>
					text
						.setPlaceholder("https://api.plane.so")
						.setValue(this.plugin.settings.apiBaseUrl)
						.onChange(async (value) => {
							this.plugin.settings.apiBaseUrl = value.trim() || DEFAULT_SETTINGS.apiBaseUrl;
							await this.plugin.savePersisted();
						}),
				);

			new Setting(containerEl)
				.setName("Workspace slug")
				.setDesc("Find this in plane → workspace settings.")
				.addText((text) =>
					text
						.setPlaceholder("My workspace")
						.setValue(this.plugin.settings.workspaceSlug)
						.onChange(async (value) => {
							this.plugin.settings.workspaceSlug = value.trim();
							await this.plugin.savePersisted();
						}),
				);

			new Setting(containerEl)
				.setName("Default project ID")
				.setDesc("UUID of the project to open first; you can switch projects inside the hub.")
				.addText((text) =>
					text
						.setPlaceholder("Example project identifier")
						.setValue(this.plugin.settings.defaultProjectId)
						.onChange(async (value) => {
							this.plugin.settings.defaultProjectId = value.trim();
							await this.plugin.savePersisted();
						}),
				);

			new Setting(containerEl)
				.setName("Default module ID")
				.setDesc("Optional module UUID to pre-filter items.")
				.addText((text) =>
					text
						.setPlaceholder("Optional module ID")
						.setValue(this.plugin.settings.defaultModuleId ?? "")
						.onChange(async (value) => {
							this.plugin.settings.defaultModuleId = value.trim();
							await this.plugin.savePersisted();
						}),
				);

			new Setting(containerEl)
				.setName("API token")
				.setDesc("Create a personal API token in plane → profile → developer settings.")
				.addText((text) =>
					text
						.setPlaceholder("Plane API token")
						.setValue(this.plugin.settings.apiKey)
						.onChange(async (value) => {
							this.plugin.settings.apiKey = value.trim();
							await this.plugin.savePersisted();
						}),
				);

			new Setting(containerEl)
				.setName("Sync on load")
				.setDesc("Pull modules and work items automatically when Obsidian starts.")
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.syncOnLoad).onChange(async (value) => {
						this.plugin.settings.syncOnLoad = value;
						await this.plugin.savePersisted();
					}),
				);

			new Setting(containerEl)
				.setName("Note folder")
				.setDesc("Where to create or update plane-linked notes in your vault.")
				.addText((text) =>
					text
						.setPlaceholder("Plane")
					.setValue(this.plugin.settings.noteFolder)
					.onChange(async (value) => {
						this.plugin.settings.noteFolder = value.trim() || DEFAULT_SETTINGS.noteFolder;
						await this.plugin.savePersisted();
					}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Checks credentials and workspace/project access.")
			.addButton((button: ButtonComponent) =>
				button
					.setButtonText("Run")
					.onClick(async () => {
						button.setDisabled(true).setButtonText("Testing…");
						const ok = await this.plugin.testConnection();
						button.setDisabled(false).setButtonText("Run");
						if (ok) {
							new Notice("Plane connection OK");
						}
					}),
			);

		new Setting(containerEl)
			.setName("Manual sync")
			.setDesc("Pull the latest modules and work items right now.")
			.addButton((button: ButtonComponent) =>
				button
					.setButtonText("Sync now")
					.onClick(async () => {
						button.setDisabled(true).setButtonText("Syncing…");
						await this.plugin.syncFromPlane(true);
						button.setDisabled(false).setButtonText("Sync now");
					}),
			);
	}
}
