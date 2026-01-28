import { Notice, requestUrl, type RequestUrlParam } from "obsidian";
import type { PlaneSettings } from "./settings";
import type { PlaneModule, PlaneWorkItem, PlaneListResponse, PlaneProject, PlaneState } from "./types";

interface WorkItemPayload {
	name: string;
	description_html?: string | null;
	state?: string | null;
	priority?: string | null;
	module?: string | null;
	start_date?: string | null;
	target_date?: string | null;
}

interface ModulePayload {
	name: string;
	status?: string | null;
	description?: string | null;
	start_date?: string | null;
	target_date?: string | null;
}

export class PlaneClient {
	private readonly getSettings: () => PlaneSettings;

	constructor(settingsProvider: () => PlaneSettings) {
		this.getSettings = settingsProvider;
	}

	async listProjects(): Promise<PlaneProject[]> {
		return await this.fetchAllPages<PlaneProject>("projects/");
	}

	async listModules(projectId?: string): Promise<PlaneModule[]> {
		return await this.fetchAllPages<PlaneModule>(
			`projects/${projectId ?? this.getSettings().defaultProjectId}/modules/`,
		);
	}

	async listStates(projectId?: string): Promise<PlaneState[]> {
		return await this.fetchAllPages<PlaneState>(
			`projects/${projectId ?? this.getSettings().defaultProjectId}/states/`,
		);
	}

	async listWorkItems(projectId?: string, moduleId?: string): Promise<PlaneWorkItem[]> {
		const query: Record<string, string> = { expand: "state,module,module_id" };
		if (moduleId) query.module = moduleId;
		return await this.fetchAllPages<PlaneWorkItem>(
			`projects/${projectId ?? this.getSettings().defaultProjectId}/work-items/`,
			query,
		);
	}

	async createWorkItem(payload: WorkItemPayload, projectId?: string): Promise<PlaneWorkItem> {
		const json = await this.request<PlaneWorkItem>(
			`projects/${projectId ?? this.getSettings().defaultProjectId}/work-items/`,
			{ method: "POST", body: payload },
		);
		return json;
	}

	async updateWorkItem(id: string, payload: Partial<WorkItemPayload>, projectId?: string): Promise<PlaneWorkItem> {
		const json = await this.request<PlaneWorkItem>(
			`projects/${projectId ?? this.getSettings().defaultProjectId}/work-items/${id}/`,
			{ method: "PATCH", body: payload },
		);
		return json;
	}

	async createModule(payload: ModulePayload, projectId?: string): Promise<PlaneModule> {
		const json = await this.request<PlaneModule>(
			`projects/${projectId ?? this.getSettings().defaultProjectId}/modules/`,
			{ method: "POST", body: payload },
		);
		return json;
	}

	async updateModule(id: string, payload: Partial<ModulePayload>, projectId?: string): Promise<PlaneModule> {
		const json = await this.request<PlaneModule>(
			`projects/${projectId ?? this.getSettings().defaultProjectId}/modules/${id}/`,
			{ method: "PATCH", body: payload },
		);
		return json;
	}

	async ping(): Promise<boolean> {
		try {
			await this.request(`projects/`);
			return true;
		} catch (error) {
			new Notice(`Plane connection failed: ${String(error)}`);
			return false;
		}
	}

	private async request<T>(
		path: string,
		options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; query?: Record<string, string> } = {},
	): Promise<T> {
		const settings = this.getSettings();
		if (!settings.apiKey || !settings.workspaceSlug || !settings.apiBaseUrl) {
			throw new Error("Plane settings are incomplete.");
		}
		const method = options.method ?? "GET";
		const url = this.buildUrl(path, settings, options.query);
		const params: RequestUrlParam = {
			url,
			method,
			headers: {
				"Content-Type": "application/json",
				"x-api-key": settings.apiKey,
			},
			throw: false,
			body: options.body ? JSON.stringify(options.body) : undefined,
		};

		const response = await requestUrl(params);
		if (response.status >= 200 && response.status < 300) {
			return response.json as T;
		}
		let message = `Plane API ${method} ${url} failed (${response.status})`;
		if (response.text) {
			message += `: ${response.text.slice(0, 200)}`;
		}
		throw new Error(message);
	}

	private buildUrl(path: string, settings: PlaneSettings, query?: Record<string, string>): string {
		const trimmed = settings.apiBaseUrl.replace(/\/$/, "");
		const queryString = query
			? `?${Object.entries(query)
					.filter(([, value]) => Boolean(value))
					.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
					.join("&")}`
			: "";
		return `${trimmed}/api/v1/workspaces/${settings.workspaceSlug}/${path}${queryString}`;
	}

	private async fetchAllPages<T>(
		path: string,
		query?: Record<string, string>,
	): Promise<T[]> {
		const results: T[] = [];
		let cursor: string | undefined;

		do {
			const pageQuery: Record<string, string> = { per_page: "50", ...query };
			if (cursor) pageQuery.cursor = cursor;

			const response = await this.request<PlaneListResponse<T> | T[]>(path, { query: pageQuery });
			if (Array.isArray(response)) {
				results.push(...response);
				break;
			}
			if (response?.results) {
				results.push(...response.results);
				cursor = response.next_cursor && response.next_page_results ? response.next_cursor : undefined;
			} else {
				break;
			}
		} while (cursor);

		return results;
	}
}
