package com.nabocorp.companion

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

@Composable internal fun CompanionTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) darkColorScheme(
        primary = Color(0xFF99C7FF), onPrimary = Color(0xFF00315C), primaryContainer = Color(0xFF123A60), onPrimaryContainer = Color(0xFFD6E8FF),
        secondary = Color(0xFFC7C7CC), onSecondary = Color(0xFF1C1C1E), secondaryContainer = Color(0xFF2C2C2E), onSecondaryContainer = Color(0xFFF2F2F7),
        tertiary = Color(0xFF99C7FF), onTertiary = Color(0xFF00315C), tertiaryContainer = Color(0xFF123A60), onTertiaryContainer = Color(0xFFD6E8FF),
        background = Color.Black, onBackground = Color(0xFFF2F2F7), surface = Color(0xFF1C1C1E), onSurface = Color(0xFFF2F2F7),
        surfaceVariant = Color(0xFF2C2C2E), onSurfaceVariant = Color(0xFFAEAEB2), surfaceTint = Color.Transparent,
        surfaceDim = Color.Black, surfaceBright = Color(0xFF3A3A3C), surfaceContainerLowest = Color.Black,
        surfaceContainerLow = Color.Black, surfaceContainer = Color(0xFF1C1C1E), surfaceContainerHigh = Color(0xFF2C2C2E), surfaceContainerHighest = Color(0xFF3A3A3C),
        outline = Color(0xFF8E8E93), outlineVariant = Color(0xFF38383A), inverseSurface = Color(0xFFE5E5EA), inverseOnSurface = Color(0xFF1C1C1E), inversePrimary = Color(0xFF087FFF),
    ) else lightColorScheme(
        primary = Color(0xFF087FFF), onPrimary = Color.White, primaryContainer = Color(0xFFE5F0FF), onPrimaryContainer = Color(0xFF004F9F),
        secondary = Color(0xFF636366), onSecondary = Color.White, secondaryContainer = Color(0xFFE5E5EA), onSecondaryContainer = Color(0xFF1C1C1E),
        tertiary = Color(0xFF087FFF), onTertiary = Color.White, tertiaryContainer = Color(0xFFE5F0FF), onTertiaryContainer = Color(0xFF004F9F),
        background = Color.White, onBackground = Color(0xFF1C1C1E), surface = Color.White, onSurface = Color(0xFF1C1C1E),
        surfaceVariant = Color(0xFFF2F2F7), onSurfaceVariant = Color(0xFF636366), surfaceTint = Color.Transparent,
        surfaceDim = Color(0xFFDADADC), surfaceBright = Color.White, surfaceContainerLowest = Color.White,
        surfaceContainerLow = Color(0xFFF2F2F7), surfaceContainer = Color(0xFFF2F2F7), surfaceContainerHigh = Color(0xFFEAEAEE), surfaceContainerHighest = Color(0xFFE5E5EA),
        outline = Color(0xFF8E8E93), outlineVariant = Color(0xFFD1D1D6), inverseSurface = Color(0xFF2C2C2E), inverseOnSurface = Color(0xFFF2F2F7), inversePrimary = Color(0xFF99C7FF),
    )
    MaterialTheme(colorScheme = colors, typography = CompanionTypography, content = content)
}

/** Native text takes the font's own line height, like the system text of the iOS app, instead of Material's roomy fixed leading. */
private val CompanionTypography = Typography().let { base ->
    fun androidx.compose.ui.text.TextStyle.tight() = copy(lineHeight = androidx.compose.ui.unit.TextUnit.Unspecified)
    base.copy(displayLarge = base.displayLarge.tight(), displayMedium = base.displayMedium.tight(), displaySmall = base.displaySmall.tight(),
        headlineLarge = base.headlineLarge.tight(), headlineMedium = base.headlineMedium.tight(), headlineSmall = base.headlineSmall.tight(),
        titleLarge = base.titleLarge.tight(), titleMedium = base.titleMedium.tight(), titleSmall = base.titleSmall.tight(),
        bodyLarge = base.bodyLarge.tight(), bodyMedium = base.bodyMedium.tight(), bodySmall = base.bodySmall.tight(),
        labelLarge = base.labelLarge.tight(), labelMedium = base.labelMedium.tight(), labelSmall = base.labelSmall.tight())
}

internal object CompanionColors {
    val sheetBackground: Color @Composable get() = MaterialTheme.colorScheme.surfaceContainerLow
    val addedLines: Color @Composable get() = if (isSystemInDarkTheme()) Color(0xFF80D49A) else Color(0xFF237A3B)
    val worktree: Color @Composable get() = if (isSystemInDarkTheme()) Color(0xFFFFB66C) else Color(0xFFB85800)
    val unread: Color get() = Color(0xFFFF3B30)
    val attention: Color @Composable get() = if (isSystemInDarkTheme()) Color(0xFFD5B5FF) else Color(0xFF7951A8)
}
