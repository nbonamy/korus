package com.nabocorp.companion

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable internal fun ComposerAttachmentsView(drafts: ComposerDrafts, open: (ComposerAttachment) -> Unit) {
    if (drafts.items.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        drafts.items.forEach { item ->
            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                Row(Modifier.padding(start = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (item.type == "image") {
                        val thumbnail = remember(item.id) { BitmapFactory.decodeByteArray(item.data, 0, item.data.size, BitmapFactory.Options().apply { inSampleSize = 8 })?.asImageBitmap() }
                        if (thumbnail != null) Image(thumbnail, "View ${item.name}", Modifier.size(44.dp).clip(RoundedCornerShape(6.dp)).clickable { open(item) }, contentScale = ContentScale.Crop)
                    } else Icon(Icons.Outlined.Description, null, Modifier.size(32.dp))
                    Text(item.name, Modifier.widthIn(max = 130.dp).padding(horizontal = 6.dp), maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall)
                    IconButton(onClick = { drafts.remove(item.id) }, enabled = !drafts.sending) { Icon(Icons.Outlined.Close, "Remove ${item.name}") }
                }
            }
        }
    }
    if (drafts.importing) Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Text("Preparing attachments…", Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodySmall)
    }
    drafts.error?.let { error -> Row(verticalAlignment = Alignment.CenterVertically) {
        Text(error, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        IconButton(onClick = drafts::dismissError) { Icon(Icons.Outlined.Close, "Dismiss attachment message") }
    } }
}

@Composable internal fun AttachmentImageDialog(item: ComposerAttachment, dismiss: () -> Unit) {
    val preview = remember(item.id) { ImagePreview(item.name, ImagePreview.Source.Bytes(item.data)) }
    ImagePreviewDialog(preview, dismiss)
}
