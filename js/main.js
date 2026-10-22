"use strict";

/* Entry point: all shared-scope browser scripts are loaded before init. */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
