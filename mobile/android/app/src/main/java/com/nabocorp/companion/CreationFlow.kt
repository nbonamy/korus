package com.nabocorp.companion

import org.json.JSONObject

internal enum class CreationKind { PROJECT, LOCAL, URL, GITHUB, GITLAB, EXISTING, WORKTREE, QUICK, DEFAULT }

internal fun JSONObject.creationBackends(repositoryId: String? = null): List<String> =
    repositoryId?.let { obj("repositoryBackends").optJSONArray(it) }?.let { choices -> (0 until choices.length()).map { choices.getString(it) } } ?: strings("backends")

/** Native form state only; catalogs, workspace mutation and resulting agent selection stay in the engine. */
internal data class CreationFlow(
    val hostId: String, val teamId: String, val kind: CreationKind,
    val repositoryId: String? = null, val repositoryName: String = "",
    val value: String = "", val query: String = "", val branchQuery: String = "",
    val newBranch: Boolean = false, val branchName: String = "", val baseBranch: String = "", val selectedBranch: String? = null,
    val submitted: Boolean = false, val observedCreating: Boolean = false,
) {
    fun backends(state: JSONObject): List<String> = state.creationBackends(repositoryId.takeIf { kind in listOf(CreationKind.EXISTING, CreationKind.WORKTREE, CreationKind.DEFAULT) })
    val projectCatalog get() = kind in listOf(CreationKind.GITHUB, CreationKind.GITLAB, CreationKind.LOCAL)
    val projectSource get() = when (kind) {
        CreationKind.LOCAL -> "local"
        CreationKind.GITLAB -> "gitlab"
        else -> "github"
    }
    val providerName get() = if (kind == CreationKind.GITLAB) "GitLab" else "GitHub"
    val title get() = when (kind) {
        CreationKind.PROJECT -> "New Project"
        CreationKind.URL -> "Repository URL"
        CreationKind.LOCAL -> if (newBranch) "New Branch" else if (repositoryId != null) "Choose Branch" else "Existing Project"
        CreationKind.GITHUB, CreationKind.GITLAB -> if (newBranch) "New Branch" else if (repositoryId != null) "Choose Branch" else "$providerName Repository"
        CreationKind.EXISTING -> "Existing Branch"
        CreationKind.WORKTREE -> "New Worktree"
        CreationKind.QUICK -> "Quick Chat"
        CreationKind.DEFAULT -> "Default Branch"
    }
    val action get() = when (kind) {
        CreationKind.PROJECT -> "Create Project"
        CreationKind.URL -> "Clone Repository"
        CreationKind.GITHUB, CreationKind.GITLAB, CreationKind.LOCAL -> if (newBranch) "Create Branch" else null
        CreationKind.WORKTREE -> "Create Worktree"
        CreationKind.QUICK, CreationKind.DEFAULT -> "Retry"
        CreationKind.EXISTING -> null
    }
    fun catalog(state: JSONObject): JSONObject {
        val catalog = state.obj(if (kind == CreationKind.EXISTING) "branches" else "projectBranches")
        return if (catalog.string("repositoryId") == repositoryId) catalog else json("status" to "loading")
    }
    fun command(state: JSONObject, backend: String): JSONObject? {
        if (submitted || !state.connection.isConnected || state.string("chatCreation") == "creating" ||
            state.string("laptopId", state.obj("composerTarget").string("hostId")) != hostId || state.string("teamId") != teamId ||
            !backends(state).contains(backend)) return null
        val input = value.trim()
        return when (kind) {
            CreationKind.PROJECT, CreationKind.URL -> {
                if (input.isEmpty() || kind == CreationKind.PROJECT && (input in listOf(".", "..") || input.any { it == '/' || it == '\\' })) return null
                json("type" to "createProject", "source" to if (kind == CreationKind.PROJECT) "new" else "url", "value" to input, "selection" to json("backend" to backend))
            }
            CreationKind.GITHUB, CreationKind.GITLAB, CreationKind.LOCAL -> {
                val repository = repositoryId ?: return null
                val catalog = catalog(state)
                if (catalog.string("status") != "loaded") return null
                val names = catalog.items("items").map { it.string("name") }
                json("type" to "createProject", "source" to projectSource, "value" to repository, "selection" to json("backend" to backend)).apply {
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
