/* registered only for the mobile view sites; hands the user-agent to page_context/inject.js */
chrome.storage.local.get("useragent", function (e) {
  localStorage.setItem("mobview-useragent", (e && e.useragent) || defaults.useragent);
});
