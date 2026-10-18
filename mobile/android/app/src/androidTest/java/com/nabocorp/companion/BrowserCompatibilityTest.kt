package com.nabocorp.companion

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** libp2p's streams require Promise.withResolvers, including in older bundled Android WebViews. */
class BrowserCompatibilityTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    @Test fun bundledEngineSupportsTransportPromiseResolutionAndRejection() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.evaluate("""
                window.compatibilityProbe = 'pending';
                try {
                    const accepted = Promise.withResolvers();
                    const rejected = Promise.withResolvers();
                    Promise.all([accepted.promise, rejected.promise.catch(error => error.message)])
                        .then(values => window.compatibilityProbe = values.join('/'));
                    accepted.resolve('resolved'); rejected.reject(new Error('rejected'));
                } catch (error) { window.compatibilityProbe = error.name + ': ' + error.message; }
            """.trimIndent())
            app.waitUntil(5000) { engine.evaluate("window.compatibilityProbe") != "pending" }
            assertEquals("resolved/rejected", engine.evaluate("window.compatibilityProbe"))
        }
    }
}
