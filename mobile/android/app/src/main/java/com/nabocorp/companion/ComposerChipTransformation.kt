package com.nabocorp.companion

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation

/** Only presentation changes: selection and the clipboard retain the canonical tokens. */
class ComposerChipTransformation(private val chips: List<ComposerChip>, private val foreground: Color, private val background: Color) : VisualTransformation {
    private data class Span(val sourceStart: Int, val sourceEnd: Int, val displayStart: Int, val displayEnd: Int)
    override fun filter(text: AnnotatedString): TransformedText {
        val rendered = AnnotatedString.Builder()
        val spans = mutableListOf<Span>()
        var copied = 0
        chips.filter { it.start >= 0 && it.end <= text.length }.forEach { chip ->
            rendered.append(text.subSequence(copied, chip.start))
            val start = rendered.length
            rendered.pushStyle(SpanStyle(color = foreground, background = background, fontWeight = FontWeight.Medium))
            rendered.append("\u00a0${chip.item.name.replace(' ', '\u00a0')}\u00a0")
            rendered.pop()
            spans.add(Span(chip.start, chip.end, start, rendered.length)); copied = chip.end
        }
        rendered.append(text.subSequence(copied, text.length))
        val result = rendered.toAnnotatedString()
        return TransformedText(result, object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int {
                var delta = 0
                spans.forEach { span ->
                    if (offset <= span.sourceStart) return (offset + delta).coerceIn(0, result.length)
                    if (offset < span.sourceEnd) return if ((offset - span.sourceStart) * 2 < span.sourceEnd - span.sourceStart) span.displayStart else span.displayEnd
                    delta += (span.displayEnd - span.displayStart) - (span.sourceEnd - span.sourceStart)
                }
                return (offset + delta).coerceIn(0, result.length)
            }
            override fun transformedToOriginal(offset: Int): Int {
                var delta = 0
                spans.forEach { span ->
                    if (offset <= span.displayStart) return (offset + delta).coerceIn(0, text.length)
                    if (offset < span.displayEnd) return if ((offset - span.displayStart) * 2 < span.displayEnd - span.displayStart) span.sourceStart else span.sourceEnd
                    delta += (span.sourceEnd - span.sourceStart) - (span.displayEnd - span.displayStart)
                }
                return (offset + delta).coerceIn(0, text.length)
            }
        })
    }
}
