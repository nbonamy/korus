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
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.outlined.Close
import androidx.compose.ui.unit.sp
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
            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.12f)) {
                Row(Modifier.padding(start = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (item.type == "image") {
                        val thumbnail = remember(item.id) { BitmapFactory.decodeByteArray(item.data, 0, item.data.size, BitmapFactory.Options().apply { inSampleSize = 8 })?.asImageBitmap() }
                        if (thumbnail != null) Image(thumbnail, "View ${item.name}", Modifier.size(44.dp).clip(RoundedCornerShape(6.dp)).clickable { open(item) }, contentScale = ContentScale.Crop)
                    } else Icon(Icons.Outlined.Description, null, Modifier.size(32.dp))
                    Text(item.name, Modifier.widthIn(max = 130.dp).padding(horizontal = 6.dp), maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 12.sp)
                    IconButton(onClick = { drafts.remove(item.id) }, enabled = !drafts.sending, modifier = Modifier.size(width = 36.dp, height = 44.dp)) { Icon(Icons.Filled.Cancel, "Remove ${item.name}", Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
    if (drafts.importing) Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Text("Preparing attachments…", Modifier.padding(start = 8.dp), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    drafts.error?.let { error -> Row(verticalAlignment = Alignment.CenterVertically) {
        Text(error, Modifier.weight(1f), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        IconButton(onClick = drafts::dismissError) { Icon(Icons.Outlined.Close, "Dismiss attachment message") }
    } }
}

@Composable internal fun AttachmentImageDialog(item: ComposerAttachment, dismiss: () -> Unit) {
    val preview = remember(item.id) { ImagePreview(item.name, ImagePreview.Source.Bytes(item.data)) }
    ImagePreviewDialog(preview, dismiss)
}
