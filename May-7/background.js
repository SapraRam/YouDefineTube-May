// Initialize default settings when extension is installed
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(['topics', 'activeTopic', 'hideShorts', 'hideSidebar', 'hideComments', 'apiKey'], (data) => {
        // Only set defaults if they don't exist
        const defaults = {};
        
        if (!data.topics) defaults.topics = [];
        if (data.activeTopic === undefined) defaults.activeTopic = '';
        if (data.hideShorts === undefined) defaults.hideShorts = false;
        if (data.hideSidebar === undefined) defaults.hideSidebar = false;
        if (data.hideComments === undefined) defaults.hideComments = false;
        if (data.apiKey === undefined) defaults.apiKey = 'AIzaSyDkluN2A2lmSCmWkJ6_9NDZB_IZ5vZ5eoU'
        
        if (Object.keys(defaults).length > 0) {
            chrome.storage.sync.set(defaults);
        }
    });
});

// Track YouTube tabs to ensure content script is working
const youtubeTabsStatus = {};

// Listen for extension icon clicks
chrome.action.onClicked.addListener(() => {
    // Check if we're already on YouTube
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        const isYouTube = currentTab && currentTab.url && currentTab.url.includes('youtube.com');
        
        // If we're not on YouTube, open it in a new tab
        if (!isYouTube) {
            chrome.tabs.create({ url: "https://www.youtube.com" });
        }
    });
});

// Listen for tab updates to apply settings as soon as YouTube is detected
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only proceed if this is a YouTube URL
    if (tab.url && tab.url.includes('youtube.com')) {
        // Check if it's the homepage specifically
        const isHomepage = tab.url === 'https://www.youtube.com/' || 
                          tab.url.includes('youtube.com/feed/recommended') ||
                          tab.url.endsWith('youtube.com');
        
        // Track this tab as a YouTube tab
        youtubeTabsStatus[tabId] = youtubeTabsStatus[tabId] || {};
        youtubeTabsStatus[tabId].isHomepage = isHomepage;
        
        // Different actions based on loading state
        if (changeInfo.status === 'loading' && isHomepage) {
            // Only send message early if it's the homepage
            youtubeTabsStatus[tabId].messageAttempts = 0;
            sendMessageToTab(tabId);
        } else if (changeInfo.status === 'complete') {
            // Always send on complete for reliability
            youtubeTabsStatus[tabId].messageAttempts = 0;
            sendMessageToTab(tabId);
        }
    }
});

// Clean up tab tracking when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
    if (youtubeTabsStatus[tabId]) {
        delete youtubeTabsStatus[tabId];
    }
});

// Attempt to send a message to the content script with retry logic
function sendMessageToTab(tabId, maxAttempts = 3) {
    // Skip if tab doesn't exist in our tracking
    if (!youtubeTabsStatus[tabId]) return;
    
    // Increment attempt counter
    youtubeTabsStatus[tabId].messageAttempts = (youtubeTabsStatus[tabId].messageAttempts || 0) + 1;
    
    // Send message to content script
    chrome.tabs.sendMessage(tabId, { 
        action: 'updateSettings'
    }, (response) => {
        // Check for error (which means content script isn't ready)
        if (chrome.runtime.lastError) {
            // If we have attempts left, try again after a delay
            if (youtubeTabsStatus[tabId] && youtubeTabsStatus[tabId].messageAttempts < maxAttempts) {
                setTimeout(() => sendMessageToTab(tabId, maxAttempts), 200);
            }
        }
    });
}