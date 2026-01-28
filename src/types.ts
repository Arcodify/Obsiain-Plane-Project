export interface PlaneModule {
	id: string;
	name: string;
	status?: string;
	start_date?: string | null;
	target_date?: string | null;
	description?: string | null;
	lead?: string | null;
	members?: string[];
	project_id: string;
}

export interface PlaneWorkItem {
	id: string;
	name: string;
	description_html?: string | null;
	description_stripped?: string | null;
	state?: string | null;
	state_id?: string | null;
	priority?: string | null;
	module?: string | null;
	module_id?: string | null; // Plane often returns module_id
	project_id: string;
	identifier?: string;
}

export interface PlaneListResponse<T> {
	results: T[];
	next_cursor?: string;
	next_page_results?: boolean;
	count?: number;
}

export interface PlaneState {
	id: string;
	name: string;
	group?: string;
	color?: string;
}

export interface PlaneProject {
	id: string;
	name: string;
	identifier?: string;
}

export interface ProjectCache {
	modules: PlaneModule[];
	workItems: PlaneWorkItem[];
	states: PlaneState[];
	lastSync?: number;
}

export interface PlaneCache {
	projects: Record<string, ProjectCache>;
	selectedProjectId?: string;
}

export interface PersistedData {
	settings?: unknown;
	cache?: PlaneCache;
}
