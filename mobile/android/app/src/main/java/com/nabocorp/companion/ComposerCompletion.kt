package com.nabocorp.companion

import androidx.compose.runtime.*
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.json.JSONObject
import org.json.JSONArray

data class ComposerSuggestion(val id: String, val name: String, val insertText: String, val description: String, val kind: String, val value: String = insertText) {
    val trigger get() = if (kind == "skill") '$' else '@'
    val token get() = "$trigger$insertText"
    companion object {
        fun parse(value: JSONObject) = ComposerSuggestion(value.string("id"), value.string("name"), value.string("insertText"), value.string("description"), value.string("kind", "skill"), value.string("value", value.string("insertText")))
    }
}

/** Android and the engine use UTF-16 cursor offsets. A query consumes the rest of its token when editing in the middle. */
data class ComposerQuery(val query: String, val start: Int, val end: Int, val trigger: Char) {
    val isSkill get() = trigger == '$'
    fun matches(items: List<ComposerSuggestion>) = items.filter { it.trigger == trigger &&
        (query.isEmpty() || listOf(it.name, it.insertText, it.description).any { text -> text.contains(query, ignoreCase = true) }) }
    fun insert(item: ComposerSuggestion, text: String): TextFieldValue? {
        if (item.trigger != trigger || start !in 0..text.length || end !in start..text.length) return null
        val suffix = text.substring(end).removePrefix(" ")
        val insertion = item.token + " "
        return TextFieldValue(text.take(start) + insertion + suffix, TextRange(start + insertion.length))
    }
    companion object {
        private val pattern = Regex("(?<![\\p{L}\\p{M}\\p{N}\\p{Pc}.%+/@$-])([@$])([^\\s/@$]*)$")
        fun at(value: TextFieldValue): ComposerQuery? {
            val caret = value.selection.start
            if (!value.selection.collapsed || caret !in 0..value.text.length || !boundary(value.text, caret)) return null
            val prefix = value.text.take(caret)
            if (prefix.count { it == '`' } % 2 != 0) return null
            val match = pattern.find(prefix) ?: return null
            val suffix = value.text.substring(caret).takeWhile { !it.isWhitespace() && it !in "/@$" }
            return ComposerQuery(match.groupValues[2], match.range.first, caret + suffix.length, match.groupValues[1][0])
        }
    }
}

data class ComposerChip(val start: Int, val end: Int, val item: ComposerSuggestion)
private fun boundary(text: String, index: Int) = index == 0 || index == text.length || !(text[index].isLowSurrogate() && text[index - 1].isHighSurrogate())

/** Canonical text stays in the draft. Chip ranges survive adjacent edits, including removal of their trailing space. */
class ComposerEditorState(text: String, catalog: List<ComposerSuggestion>, selected: List<ComposerChip> = emptyList()) {
    var value by mutableStateOf(TextFieldValue(text, TextRange(text.length)))
        private set
    var chips by mutableStateOf(selected)
        private set
    private var catalog = catalog
    val query get() = ComposerQuery.at(value)?.takeUnless { query -> chips.any { it.start == query.start && it.end == query.end } }

    fun synchronize(text: String, items: List<ComposerSuggestion>, selected: List<ComposerChip> = chips) {
        if (text != value.text || selected != chips) {
            value = TextFieldValue(text, TextRange(text.length)); chips = selected
            refresh(items)
        } else if (catalog != items) refresh(items)
    }
    fun choose(item: ComposerSuggestion): Boolean {
        if (item !in catalog) return false
        val target = query ?: return false
        val inserted = target.insert(item, value.text) ?: return false
        edit(inserted)
        chips = (chips + ComposerChip(target.start, target.start + item.token.length, item)).sortedBy { it.start }
        return true
    }
    fun edit(next: TextFieldValue) {
        val before = value
        if (before.text == next.text) {
            val selection = next.selection
            fun snap(offset: Int, towardsEnd: Boolean) = chips.firstOrNull { offset > it.start && offset < it.end }?.let { if (towardsEnd) it.end else it.start } ?: offset
            val normalized = if (selection.collapsed) TextRange(snap(selection.start, selection.start >= before.selection.start))
                else if (selection.start < selection.end) TextRange(snap(selection.start, false), snap(selection.end, true))
                else TextRange(snap(selection.start, true), snap(selection.end, false))
            value = next.copy(selection = normalized)
            refresh(catalog)
            return
        }
        var start = 0
        while (start < minOf(before.text.length, next.text.length) && before.text[start] == next.text[start]) start++
        while (start > 0 && (!boundary(before.text, start) || !boundary(next.text, start))) start--
        var suffix = 0
        while (suffix < minOf(before.text.length, next.text.length) - start && before.text[before.text.lastIndex - suffix] == next.text[next.text.lastIndex - suffix]) suffix++
        while (suffix > 0 && (!boundary(before.text, before.text.length - suffix) || !boundary(next.text, next.text.length - suffix))) suffix--
        var end = before.text.length - suffix
        val insertedEnd = next.text.length - suffix
        val affected = chips.filter { if (start == end) start > it.start && start < it.end else start < it.end && end > it.start }
        val replacement = next.text.substring(start, insertedEnd)
        if (affected.isNotEmpty()) {
            start = minOf(start, affected.minOf { it.start }); end = maxOf(end, affected.maxOf { it.end })
        }
        val delta = replacement.length - (end - start)
        chips = chips.filterNot { it in affected }.map { if (it.start >= end) it.copy(start = it.start + delta, end = it.end + delta) else it }
        value = if (affected.isEmpty()) next else TextFieldValue(before.text.take(start) + replacement + before.text.substring(end), TextRange(start + replacement.length))
        refresh(catalog)
    }
    private fun refresh(items: List<ComposerSuggestion>) {
        catalog = items
        chips = chips.filter { it.start >= 0 && it.end <= value.text.length && value.text.substring(it.start, it.end) == it.item.token }
    }
}

fun composerPromptContent(text: String, chips: List<ComposerChip>): JSONArray = JSONArray().apply {
    var cursor = 0
    chips.forEach { chip ->
        if (chip.start > cursor) put(json("type" to "text", "text" to text.substring(cursor, chip.start)))
        val item = chip.item
        val id = if (item.kind == "agent") item.id.removePrefix("agent:") else if (item.kind == "plugin") item.id.removePrefix("plugin:") else item.id
        put(json("type" to "mention", "kind" to if (item.kind == "agent") "custom" else item.kind, "id" to id,
            "label" to item.name, "value" to item.value).apply { if (item.kind == "agent") put("groupId", "agents") })
        cursor = chip.end
    }
    if (cursor < text.length) put(json("type" to "text", "text" to text.substring(cursor)))
}
