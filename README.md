# Plane Project Obsidian Plugin

Manage [Plane projects](https://plane.so/) with boards, modules, and syncing.: sync modules and work items, create and edit issues, view them in a Kanban board, and generate linked notes that push changes back to Plane when you want.

## What you can do
- Sync all modules and work items for a chosen Plane project.
- View items in a Kanban board inside an Obsidian pane (per project), with module filter.
- Create and edit work items (title, description, priority, module) and modules (name, status, description).
- Open or auto-create Obsidian notes for a work item; push the note content to Plane as the description.
- Quick command to create a work item from selected text.

## Setup
1. Install dependencies: `npm install`
2. Build: `npm run build` (outputs `main.js`).
3. Copy `main.js`, `manifest.json`, and `styles.css` to your vault at `.obsidian/plugins/plane-project/`.
4. In Obsidian settings, fill in:
   - API base URL (cloud default: `https://api.plane.so`)
   - Workspace slug
   - Default project ID (you can switch projects in the hub)
   - API token (Profile → Developer settings in Plane)
5. Click **Test connection**, then **Sync now**. Use the project dropdown in the hub to switch projects and re-sync.

## Commands
- `Plane: Open hub` – opens the management hub modal.
- `Plane: Open project board` – opens a Kanban view in a pane (select project in dropdown).
- `Plane: Sync modules and work items`
- `Plane: Create work item from selection`
- `Plane: Push current note to work item description` (requires `planeId` in note frontmatter).

## Notes
- Plugin stores synced data locally (settings + cache) and resyncs on startup if enabled.
- Notes are created in the configured folder (default `Plane/`) with frontmatter linking back to the Plane item.
