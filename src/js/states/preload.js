import { GameState } from "../core/game_state";
import { createLogger } from "../core/logging";
import { findNiceValue, waitNextFrame } from "../core/utils";
import { cachebust } from "../core/cachebust";
import { PlatformWrapperImplBrowser } from "../platform/browser/wrapper";

const logger = createLogger("state/preload");

export class PreloadState extends GameState {
    constructor() {
        super("PreloadState");
    }

    getInnerHTML() {
        return `
            <div class="loadingImage"></div>
            <div class="loadingStatus">
                <span class="desc">Booting</span>
                <span class="bar">
                    <span class="inner" style="width: 0%"></span>
                    <span class="status">0%</span>
                </span>
            </div>
            </div>
        `;
    }

    getThemeMusic() {
        return null;
    }

    getHasFadeIn() {
        return false;
    }

    onEnter(payload) {
        this.htmlElement.classList.add("prefab_LoadingState");

        const elementsToRemove = ["#loadingPreload", "#fontPreload"];
        for (let i = 0; i < elementsToRemove.length; ++i) {
            const elem = document.querySelector(elementsToRemove[i]);
            if (elem) {
                elem.remove();
            }
        }

        // this.dialogs = new HUDModalDialogs(null, this.app);
        // const dialogsElement = document.body.querySelector(".modalDialogParent");
        // this.dialogs.initializeToElement(dialogsElement);

        this.statusText = this.htmlElement.querySelector(".loadingStatus > .desc");
        this.statusBar = this.htmlElement.querySelector(".loadingStatus > .bar > .inner");
        this.statusBarText = this.htmlElement.querySelector(".loadingStatus > .bar > .status");
        this.currentStatus = "booting";
        this.currentIndex = 0;

        this.startLoading();
    }

    onLeave() {
        // this.dialogs.cleanup();
    }

    startLoading() {
        this.setStatus("Booting")

            .then(() => this.setStatus("Creating platform wrapper"))
            .then(() => this.app.platformWrapper.initialize())

            .then(() => this.setStatus("Initializing local storage"))
            .then(() => {
                const wrapper = this.app.platformWrapper;
                if (wrapper instanceof PlatformWrapperImplBrowser) {
                    try {
                        window.localStorage.setItem("local_storage_test", "1");
                        window.localStorage.removeItem("local_storage_test");
                    } catch (ex) {
                        logger.error("Failed to read/write local storage:", ex);
                        return new Promise(() => {
                            alert(`Your brower does not support thirdparty cookies or you have disabled it in your security settings.\n\n
                                In Chrome this setting is called "Block third-party cookies and site data".\n\n
                                Please allow third party cookies and then reload the page.`);
                            // Never return
                        });
                    }
                }
            })

            .then(() => this.setStatus("Creating storage"))
            .then(() => {
                return this.app.storage.initialize();
            })

            .then(() => this.setStatus("Initializing libraries"))
            .then(() => this.app.analytics.initialize())
            .then(() => this.app.gameAnalytics.initialize())

            .then(() => this.setStatus("Initializing settings"))
            .then(() => {
                return this.app.settings.initialize();
            })

            .then(() => {
                // Initialize fullscreen
                if (this.app.platformWrapper.getSupportsFullscreen()) {
                    this.app.platformWrapper.setFullscreen(this.app.settings.getIsFullScreen());
                }
            })

            .then(() => this.setStatus("Initializing sounds"))
            .then(() => {
                // Notice: We don't await the sounds loading itself
                return this.app.sound.initialize();
            })

            .then(() => {
                this.app.backgroundResourceLoader.startLoading();
            })

            .then(() => this.setStatus("Initializing savegame"))
            .then(() => {
                return this.app.savegameMgr.initialize().catch(err => {
                    logger.error("Failed to initialize savegames:", err);
                    return new Promise(resolve => {
                        // const { ok } = this.dialogs.showWarning(
                        //     T.preload.savegame_corrupt_dialog.title,
                        //     T.preload.savegame_corrupt_dialog.content,
                        //     ["ok:good"]
                        // );
                        // ok.add(resolve);
                        alert("Your savegames failed to load. They might not show up. Sorry!");
                    });
                });
            })

            .then(() => this.setStatus("Downloading resources"))
            .then(() => {
                return this.app.backgroundResourceLoader.getPromiseForBareGame();
            })

            .then(() => this.setStatus("Launching"))
            .then(
                () => {
                    this.moveToState("MainMenuState");
                },
                err => {
                    this.showFailMessage(err);
                }
            );
    }

    setStatus(text) {
        logger.log("✅ " + text);
        this.currentIndex += 1;
        this.currentStatus = text;
        this.statusText.innerText = text;

        const numSteps = 10; // FIXME

        const percentage = (this.currentIndex / numSteps) * 100.0;
        this.statusBar.style.width = percentage + "%";
        this.statusBarText.innerText = findNiceValue(percentage) + "%";

        if (G_IS_DEV) {
            return Promise.resolve();
        }
        return Promise.resolve();
        // return waitNextFrame();
    }

    showFailMessage(text) {
        logger.error("App init failed:", text);

        const email = "bugs@shapez.io";

        const subElement = document.createElement("div");
        subElement.classList.add("failureBox");

        subElement.innerHTML = `
                <div class="logo">
                    <img src="${cachebust("res/logo.png")}" alt="Shapez.io Logo">
                </div>
                <div class="failureInner">
                    <div class="errorHeader">
                    Failed to initialize application!
                    </div>
                    <div class="errorMessage">
                        ${this.currentStatus} failed:<br/>
                        ${text}
                    </div>
                    
                    <div class="supportHelp">
                    Please send me an email with steps to reproduce and what you did before this happened:
                        <br /><a class="email" href="mailto:${email}?subject=App%20does%20not%20launch">${email}</a>
                    </div>
                        
                    <div class="lower">
                        <button class="resetApp styledButton">Reset App</button>
                        <i>Build ${G_BUILD_VERSION} @ ${G_BUILD_COMMIT_HASH}</i>
                    </div>
                </div>
        `;

        this.htmlElement.classList.add("failure");
        this.htmlElement.appendChild(subElement);

        const resetBtn = subElement.querySelector("button.resetApp");
        this.trackClicks(resetBtn, this.showResetConfirm);
    }

    showResetConfirm() {
        if (confirm("Are you sure you want to reset the app? This will delete all your savegames")) {
            this.resetApp();
        }
        // const signals = this.dialogs.showWarning(T.preload.reset_app_warning.title, T.preload.reset_app_warning.desc, [
        //     "delete:bad:timeout",
        //     "cancel:good",
        // ]);
        // signals.delete.add(this.resetApp, this);
    }

    resetApp() {
        this.app.settings
            .resetEverythingAsync()
            .then(() => {
                this.app.savegameMgr.resetEverythingAsync();
            })
            .then(() => {
                this.app.settings.resetEverythingAsync();
            })
            .then(() => {
                window.location.reload();
            });
    }
}
