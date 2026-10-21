package com.nabocorp.companion

import org.json.JSONObject

internal enum class CreationKind { PROJECT, LOCAL, URL, GITHUB, EXISTING, WORKTREE, QUICK, DEFAULT }

/** Native form state only; catalogs, workspace mutation and resulting agent selection stay in the engine. */
internal data class CreationFlow(
    val hostId: String, val teamId: String, val kind: CreationKind,
    val repositoryId: String? = null, val repositoryName: String = "",
    val value: String = "", val query: String = "", val branchQuery: String = "",
    val newBranch: Boolean = false, val branchName: String = "", val baseBranch: String = "", val selectedBranch: String? = null,
    val submitted: Boolean = false, val observedCreating: Boolean = false,
) {
    val projectCatalog get() = kind == CreationKind.GITHUB || kind == CreationKind.LOCAL
    val projectSource get() = if (kind == CreationKind.LOCAL) "local" else "github"
    val title get() = when (kind) {
        CreationKind.PROJECT -> "New Project"
        CreationKind.URL -> "Repository URL"
        CreationKind.LOCAL -> if (newBranch) "New Branch" else if (repositoryId != null) "Choose Branch" else "Existing Project"
        CreationKind.GITHUB -> if (newBranch) "New Branch" else if (repositoryId != null) "Choose Branch" else "GitHub Repository"
        CreationKind.EXISTING -> "Existing Branch"
        CreationKind.WORKTREE -> "New Worktree"
        CreationKind.QUICK -> "Quick Chat"
        CreationKind.DEFAULT -> "Default Branch"
    }
    val action get() = when (kind) {
        CreationKind.PROJECT -> "Create Project"
        CreationKind.URL -> "Clone Repository"
        CreationKind.GITHUB, CreationKind.LOCAL -> if (newBranch) "Create Branch" else null
        CreationKind.WORKTREE -> "Create Worktree"
        CreationKind.QUICK, CreationKind.DEFAULT -> "Retry"
        CreationKind.EXISTING -> null
    }
    fun catalog(state: JSONObject): JSONObject {
        val catalog = state.obj(if (kind == CreationKind.EXISTING) "branches" else "projectBranches")
        return if (catalog.string("repositoryId") == repositoryId) catalog else json("status" to "loading")
    }
    fun command(state: JSONObject, backend: String): JSONObject? {
        if (submitted || state.string("connection") != "connected" || state.string("chatCreation") == "creating" ||
            state.string("laptopId", state.obj("composerTarget").string("hostId")) != hostId || state.string("teamId") != teamId ||
            !state.strings("backends").contains(backend)) return null
        val input = value.trim()
        return when (kind) {
            CreationKind.PROJECT, CreationKind.URL -> {
                if (input.isEmpty() || kind == CreationKind.PROJECT && (input in listOf(".", "..") || input.any { it == '/' || it == '\\' })) return null
                json("type" to "createProject", "source" to if (kind == CreationKind.PROJECT) "new" else "url", "value" to input, "backend" to backend)
            }
            CreationKind.GITHUB, CreationKind.LOCAL -> {
                val repository = repositoryId ?: return null
                val catalog = catalog(state)
                if (catalog.string("status") != "loaded") return null
                val names = catalog.items("items").map { it.string("name") }
                json("type" to "createProject", "source" to projectSource, "value" to repository, "backend" to backend).apply {
                    if (newBranch) {
                        val branch = branchName.trim()
                        if (branch.isBlank() || names.contains(branch) || !names.contains(baseBranch)) return null
                        put("worktree", json("branchName" to branch, "baseBranch" to baseBranch))
                    } else {
                        if (!names.contains(selectedBranch)) return null
                        put("branch", selectedBranch)
                    }
                }
            }
            CreationKind.EXISTING -> {
                val catalog = catalog(state)
                if (catalog.string("status") != "loaded" || !catalog.items("items").any { it.string("name") == selectedBranch }) return null
                json("type" to "newChat", "repositoryId" to repositoryId, "backend" to backend, "existingBranch" to selectedBranch)
            }
            CreationKind.WORKTREE -> {
                if (branchName.trim().isEmpty() || repositoryId.isNullOrBlank()) return null
                json("type" to "newChat", "repositoryId" to repositoryId, "backend" to backend, "branchName" to branchName.trim())
            }
            CreationKind.DEFAULT -> if (repositoryId.isNullOrBlank()) null else json("type" to "newChat", "repositoryId" to repositoryId, "backend" to backend)
            CreationKind.QUICK -> json("type" to "newQuickChat", "backend" to backend)
        }
    }
}
