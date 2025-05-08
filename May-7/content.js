// --- START OF FILE content.js ---

// Track if we're on the homepage
let isHomePage = false;
// Track our custom button and panel
let youdefineButton = null;
let youdefinePanel = null;
let isPanelVisible = false;
// Cache for API results to avoid redundant calls
const videoCache = {};
let lastFetchedTopic = null;


// YouTube Data API key (stored in chrome.storage.local for security)
// let apiKey = null;

// Function to check if we're on the YouTube homepage
function checkIfHomePage() {
    if (window.location.pathname === '/' || window.location.pathname === '/feed/recommended') {
        return true;
    }
    const browseElement = document.querySelector('ytd-browse');
    if (browseElement && browseElement.getAttribute('page-subtype') === 'home') {
        return true;
    }
    return false;
}

// Function to inject our custom button next to the Create button
function injectYouDefineButton() {
    if (document.getElementById('youdefine-button')) return;
    
    const endButtonsContainer = document.querySelector('ytd-masthead #end');
    if (!endButtonsContainer) {
        console.log("YouDefineTube: Could not find YouTube buttons container");
        setTimeout(injectYouDefineButton, 1000);
        return;
    }
    
    youdefineButton = document.createElement('button');
    youdefineButton.id = 'youdefine-button';
    youdefineButton.innerHTML = '<img src="' + chrome.runtime.getURL('images/icon16.png') + '" alt="YouDefineTube"> YouDefineTube';
    
    youdefinePanel = document.createElement('div');
    youdefinePanel.id = 'youdefine-panel';
    youdefinePanel.innerHTML = `        
        <label for="topic-input" id="inputLabel">Enter your learning topics:</label>
        <input type="text" id="topic-input" placeholder="e.g., JavaScript, guitar lessons, history">
        <button id="add-topic-btn">Add Topic</button>
        
        <div class="topics-container" id="topics-container">
            <!-- Topics will be added here dynamically -->
        </div>
        
        <div class="video-container" id="video-container" style="display: none; margin-top: 12px;">
            <h3>Filtered Videos</h3>
            <div id="video-list"></div>
        </div>
        
        <div class="toggle-container">
            <h3>Display Options</h3>
            
            <div class="toggle-option">
                <input type="checkbox" id="hide-shorts-toggle">
                <label for="hide-shorts-toggle">Hide Shorts</label>
            </div>
            
            <div class="shorts-options" id="shorts-options" style="display: none; margin-left: 52px; margin-bottom: 10px;">
                <div class="radio-option">
                    <input type="radio" id="shorts-block" name="shorts-handling" value="block">
                    <label for="shorts-block">Block shorts completely</label>
                </div>
                <div class="radio-option">
                    <input type="radio" id="shorts-convert" name="shorts-handling" value="convert">
                    <label for="shorts-convert">Convert shorts to normal videos</label>
                </div>
            </div>
            
            <div class="toggle-option">
                <input type="checkbox" id="hide-sidebar-toggle">
                <label for="hide-sidebar-toggle">Hide Sidebar</label>
            </div>
            
            <div class="toggle-option">
                <input type="checkbox" id="hide-comments-toggle">
                <label for="hide-comments-toggle">Hide Comments</label>
            </div>
        </div>
    `;
    
    youdefineButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
    });
    
    const searchContainer = document.querySelector('ytd-masthead #search-container');
    if (searchContainer) {
        endButtonsContainer.insertBefore(youdefineButton, endButtonsContainer.firstChild);
    } else {
        endButtonsContainer.appendChild(youdefineButton);
    }
    
    document.body.appendChild(youdefinePanel);
    
    setupPanelEventListeners();
    console.log("YouDefineTube: Button injected successfully");
}

// Toggle panel visibility
function togglePanel() {
    isPanelVisible = !isPanelVisible;
    if (isPanelVisible) {
        youdefinePanel.classList.add('visible');
        loadStoredSettings();
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 10);
    } else {
        youdefinePanel.classList.remove('visible');
        document.removeEventListener('click', handleClickOutside);
    }
}

// Handle clicks outside the panel to close it
function handleClickOutside(event) {
    if (youdefinePanel && youdefineButton) {
        if (!youdefinePanel.contains(event.target) && !youdefineButton.contains(event.target)) {
            isPanelVisible = false;
            youdefinePanel.classList.remove('visible');
            document.removeEventListener('click', handleClickOutside);
        }
    }
}

// Set up panel event listeners
function setupPanelEventListeners() {
    const topicInput = document.getElementById('topic-input');
    const addTopicBtn = document.getElementById('add-topic-btn');
    
    if (addTopicBtn) {
        addTopicBtn.addEventListener('click', () => addTopic(topicInput));
    }
    
    if (topicInput) {
        topicInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addTopic(topicInput);
            }
        });
    }
    
    const hideShorts = document.getElementById('hide-shorts-toggle');
    const hideSidebar = document.getElementById('hide-sidebar-toggle');
    const hideComments = document.getElementById('hide-comments-toggle');
    const shortsOptions = document.getElementById('shorts-options');
    const shortsBlock = document.getElementById('shorts-block');
    const shortsConvert = document.getElementById('shorts-convert');
    
    if (hideShorts) {
        hideShorts.addEventListener('change', function() {
            if (shortsOptions) {
                shortsOptions.style.display = this.checked ? 'block' : 'none';
            }
            saveDisplaySettings();
        });
    }
    
    if (shortsBlock) {
        shortsBlock.addEventListener('change', saveShortsHandling);
    }
    
    if (shortsConvert) {
        shortsConvert.addEventListener('change', saveShortsHandling);
    }
    
    if (hideSidebar) hideSidebar.addEventListener('change', saveDisplaySettings);
    if (hideComments) hideComments.addEventListener('change', saveDisplaySettings);
}

// Load settings from storage and apply them
function loadStoredSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local || !chrome.storage.sync) {
        console.warn('YouDefineTube: Chrome storage API not available');
        return;
    }

    try {
        // Retrieve API key from chrome.storage.local
        chrome.storage.local.get(['apiKey'], (data) => {
            apiKey = data.apiKey || null;
            if (!apiKey) {
                console.warn('YouDefineTube: API key not set in chrome.storage.local. Please set it using chrome.storage.local.set({ apiKey: "YOUR_API_KEY" }).');
            }
        });

        chrome.storage.sync.get(['topics', 'activeTopic'], function(data) {
            if (chrome.runtime.lastError) {
                console.warn('YouDefineTube: Error loading topics:', chrome.runtime.lastError);
                return;
            }

            const topics = data.topics || [];
            const activeTopic = data.activeTopic || '';
            
            const topicsContainer = document.getElementById('topics-container');
            if (!topicsContainer) return;
            
            topicsContainer.innerHTML = '';
            
            topics.forEach(topic => {
                const topicTag = document.createElement('div');
                topicTag.className = 'topic-tag';
                if (topic === activeTopic) {
                    topicTag.classList.add('active-topic');
                }
                
                const topicName = document.createElement('span');
                topicName.className = 'topic-name';
                topicName.textContent = topic;
                topicName.addEventListener('click', function() {
                    setActiveTopic(topic);
                });
                
                const removeBtn = document.createElement('span');
                removeBtn.className = 'remove';
                removeBtn.textContent = 'x';
                removeBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    removeTopic(topic);
                });
                
                topicTag.appendChild(topicName);
                topicTag.appendChild(removeBtn);
                topicsContainer.appendChild(topicTag);
            });

            if (activeTopic) {
                fetchVideosByTopic(activeTopic);
            } else {
                clearTopicContent();
            }
        });
    
        chrome.storage.sync.get(['hideShorts', 'hideSidebar', 'hideComments', 'shortsHandling'], function(data) {
            if (chrome.runtime.lastError) {
                console.warn('YouDefineTube: Error loading display settings:', chrome.runtime.lastError);
                return;
            }

            const hideShorts = document.getElementById('hide-shorts-toggle');
            const hideSidebar = document.getElementById('hide-sidebar-toggle');
            const hideComments = document.getElementById('hide-comments-toggle');
            const shortsOptions = document.getElementById('shorts-options');
            const shortsBlock = document.getElementById('shorts-block');
            const shortsConvert = document.getElementById('shorts-convert');
            
            if (hideShorts) hideShorts.checked = data.hideShorts || false;
            if (hideSidebar) hideSidebar.checked = data.hideSidebar || false;
            if (hideComments) hideComments.checked = data.hideComments || false;
            
            if (shortsOptions) {
                shortsOptions.style.display = data.hideShorts ? 'block' : 'none';
            }
            
            if (shortsBlock && shortsConvert) {
                const shortsHandling = data.shortsHandling || 'block';
                shortsBlock.checked = shortsHandling === 'block';
                shortsConvert.checked = shortsHandling === 'convert';
            }
            
            applySettings(data);
            
            if (data.hideShorts) {
                applyShortsHandling();
            }
        });
    } catch (error) {
        console.warn('YouDefineTube: Error accessing storage API:', error);
    }
}

// Add a new topic
function addTopic(inputElement) {
    const topic = inputElement.value.trim();
    const inputLabel = document.getElementById('inputLabel');
    
    inputElement.style.borderColor = '';
    inputLabel.style.color = '';
    
    if (!topic) {
        inputElement.style.borderColor = '#ff0000';
        inputLabel.style.color = '#ff0000';
        inputElement.classList.add('shake-animation');
        setTimeout(() => {
            inputElement.classList.remove('shake-animation');
        }, 500);
        return;
    }
    
    chrome.storage.sync.get(['topics'], function(data) {
        const topics = data.topics || [];
        
        if (!topics.includes(topic)) {
            topics.push(topic);
            chrome.storage.sync.set({ 'topics': topics }, function() {
                inputElement.value = '';
                loadStoredSettings();
                
                if (topics.length === 1) {
                    setActiveTopic(topic);
                }
            });
        } else {
            inputElement.value = '';
            setActiveTopic(topic);
        }
    });
}

// Remove a topic
function removeTopic(topicToRemove) {
    chrome.storage.sync.get(['topics', 'activeTopic'], function(data) {
        const topics = data.topics || [];
        const activeTopic = data.activeTopic || '';
        
        const updatedTopics = topics.filter(topic => topic !== topicToRemove);
        
        chrome.storage.sync.set({ 'topics': updatedTopics }, function() {
            if (topicToRemove === activeTopic) {
                chrome.storage.sync.set({ 'activeTopic': '' });
            }
            loadStoredSettings();
        });
    });
}

// Set active topic and fetch videos
function setActiveTopic(topic) {
    if (topic === lastFetchedTopic) return;

    chrome.storage.sync.set({ 'activeTopic': topic }, function() {
        lastFetchedTopic = topic;
        fetchVideosByTopic(topic);
    });
}


// Save display settings
function saveDisplaySettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        console.warn('YouDefineTube: Chrome storage API not available');
        return;
    }
    
    const hideShorts = document.getElementById('hide-shorts-toggle')?.checked || false;
    const hideSidebar = document.getElementById('hide-sidebar-toggle')?.checked || false;
    const hideComments = document.getElementById('hide-comments-toggle')?.checked || false;
    
    const settings = {
        'hideShorts': hideShorts,
        'hideSidebar': hideSidebar,
        'hideComments': hideComments
    };
    
    try {
        chrome.storage.sync.get(['shortsHandling'], function(data) {
            const shortsHandling = data.shortsHandling || 'block';
            
            chrome.storage.sync.set(settings, function() {
                if (chrome.runtime.lastError) {
                    console.warn('YouDefineTube: Error saving settings:', chrome.runtime.lastError);
                    return;
                }
                
                applySettings(settings);
                
                if (hideShorts) {
                    applyShortsHandling();
                }
            });
        });
    } catch (error) {
        console.warn('YouDefineTube: Error accessing Chrome API:', error);
        applySettings(settings);
        if (hideShorts) {
            applyShortsHandling();
        }
    }
}

// Apply display settings to the page
function applySettings(settings) {
    document.body.classList.toggle('youdefine-hide-shorts', settings.hideShorts);
    if (settings.hideShorts) {
        hideYouTubeShorts();
    } else {
        showYouTubeShorts();
    }
    
    document.body.classList.toggle('youdefine-hide-sidebar', settings.hideSidebar);
    document.body.classList.toggle('youdefine-hide-comments', settings.hideComments);
}

// Function to hide YouTube Shorts
function hideYouTubeShorts() {
    const shortsContainers = document.querySelectorAll('ytd-rich-section-renderer, ytd-reel-shelf-renderer');
    shortsContainers.forEach(container => {
        if (container.innerText.includes('Shorts')) {
            container.style.display = 'none';
        }
    });
    
    const shortsEntries = document.querySelectorAll('.yt-simple-endpoint.style-scope.ytd-guide-entry-renderer');
    shortsEntries.forEach(entry => {
        if (entry.href && entry.href.includes('/shorts')) {
            entry.style.display = 'none';
        }
    });
    
    document.body.classList.add('youdefine-hide-shorts-classes');
}

// Function to show YouTube Shorts
function showYouTubeShorts() {
    const shortsContainers = document.querySelectorAll('ytd-rich-section-renderer, ytd-reel-shelf-renderer');
    shortsContainers.forEach(container => {
        container.style.display = '';
    });
    
    const shortsEntries = document.querySelectorAll('.yt-simple-endpoint.style-scope.ytd-guide-entry-renderer');
    shortsEntries.forEach(entry => {
        if (entry.href && entry.href.includes('/shorts')) {
            entry.style.display = '';
        }
    });
    
    document.body.classList.remove('youdefine-hide-shorts-classes');
}

// Save shorts handling preference
function saveShortsHandling() {
    const shortsBlock = document.getElementById('shorts-block');
    const shortsConvert = document.getElementById('shorts-convert');
    const hideShorts = document.getElementById('hide-shorts-toggle');
    
    let shortsHandling = 'block';
    if (shortsConvert && shortsConvert.checked) {
        shortsHandling = 'convert';
    }
    
    chrome.storage.sync.set({ 'shortsHandling': shortsHandling }, function() {
        if (hideShorts && hideShorts.checked) {
            applyShortsHandling();
        }
    });
}

// Apply shorts handling based on saved preference
function applyShortsHandling() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        console.warn('YouDefineTube: Chrome storage API not available');
        processYouTubeShorts('block');
        return;
    }
    
    try {
        chrome.storage.sync.get(['hideShorts', 'shortsHandling'], function(data) {
            if (chrome.runtime.lastError) {
                console.warn('YouDefineTube: Error getting settings:', chrome.runtime.lastError);
                processYouTubeShorts('block');
                return;
            }
            
            if (!data.hideShorts) return;
            
            const shortsHandling = data.shortsHandling || 'block';
            
            processYouTubeShorts(shortsHandling);
            
            if (isShortsUrl(window.location.href)) {
                handleShortsUrl(shortsHandling);
            }
            
            setupShortsObserver(shortsHandling);
        });
    } catch (error) {
        console.warn('YouDefineTube: Error accessing Chrome API:', error);
        processYouTubeShorts('block');
    }
}

// Check if URL is a shorts URL
function isShortsUrl(url) {
    return url.includes('/shorts/');
}

// Convert shorts URL to standard video URL
function convertShortsToVideoUrl(url) {
    return url.replace('/shorts/', '/watch?v=');
}

// Handle currently loaded shorts URL
function handleShortsUrl(shortsHandling) {
    if (shortsHandling === 'convert') {
        const videoUrl = convertShortsToVideoUrl(window.location.href);
        window.location.replace(videoUrl);
    } else {
        if (window.location.pathname !== '/') {
            window.location.replace('https://www.youtube.com/');
        }
    }
}

// Process all YouTube shorts elements on the page
function processYouTubeShorts(shortsHandling) {
    try {
        const shortsSelectors = [
            'ytd-guide-entry-renderer a[href^="/shorts"]',
            'a[href^="/shorts"]',
            'ytd-guide-entry-renderer yt-formatted-string:contains("Shorts")',
            'a[title="Shorts"]',
        ];
        
        const allShortsSelectors = shortsSelectors.join(', ');
        const shortsElements = document.querySelectorAll(allShortsSelectors);
        
        shortsElements.forEach(element => {
            const tagName = element.tagName ? element.tagName.toUpperCase() : '';
            if (tagName === 'YTD-GUIDE-ENTRY-RENDERER' || tagName === 'YTD-MINI-GUIDE-ENTRY-RENDERER') {
                element.style.display = 'none';
            } else {
                const entryRenderer = element.closest('ytd-guide-entry-renderer') || 
                                    element.closest('ytd-mini-guide-entry-renderer');
                if (entryRenderer) {
                    entryRenderer.style.display = 'none';
                }
            }
        });
        
        const potentialShortsItems = [
            document.querySelector('#endpoint[href^="/shorts"]'),
            document.querySelector('a#endpoint[title="Shorts"]'),
            document.querySelector('#items > ytd-guide-entry-renderer:nth-child(2)'),
            document.querySelector('[aria-label="Shorts"]'),
        ];
        
        potentialShortsItems.forEach(item => {
            if (item) {
                const parent = item.closest('ytd-guide-entry-renderer') || 
                              item.closest('ytd-mini-guide-entry-renderer');
                if (parent) {
                    parent.style.display = 'none';
                } else {
                    item.style.display = 'none';
                }
            }
        });
        
        document.body.classList.add('youdefine-hide-shorts-nav');
        
        const homePageShortsSelectors = [
            'ytd-rich-section-renderer',
            'ytd-reel-shelf-renderer',
            '[is-shorts]',
            'ytd-shorts',
            'ytd-shorts-shelf-renderer',
            'ytd-grid-video-renderer a[href^="/shorts"]',
            'ytd-compact-video-renderer a[href^="/shorts"]',
            'ytd-video-renderer a[href^="/shorts"]'
        ];
        
        homePageShortsSelectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(element => {
                    const isShortsSection = 
                        (element.querySelector('a[href^="/shorts"]') !== null) || 
                        (element.textContent && element.textContent.includes('Shorts')) ||
                        element.hasAttribute('is-shorts') ||
                        (element.tagName && element.tagName.toUpperCase() === 'YTD-SHORTS') ||
                        (element.tagName && element.tagName.toUpperCase() === 'YTD-REEL-ITEM-RENDERER');
                        
                    if (isShortsSection) {
                        if (shortsHandling === 'block') {
                            element.style.display = 'none';
                            element.classList.remove('youdefine-converted-short');
                        } else {
                            element.style.display = '';
                            element.classList.add('youdefine-converted-short');
                            const shortsLinks = element.querySelectorAll('a[href^="/shorts"]');
                            shortsLinks.forEach(link => {
                                const originalHref = link.getAttribute('href');
                                const newHref = originalHref.replace('/shorts/', '/watch?v=');
                                link.setAttribute('href', newHref);
                                const shortsLabels = link.querySelectorAll('span, yt-formatted-string');
                                shortsLabels.forEach(label => {
                                    if (label.textContent && label.textContent.includes('Shorts')) {
                                        label.textContent = label.textContent.replace('Shorts', 'Video');
                                    }
                                });
                            });
                        }
                    }
                });
            } catch (selectorError) {
                console.log("YouDefineTube: Error with selector:", selector, selectorError);
            }
        });
        
        const shortsContentElements = [
            ...document.querySelectorAll('ytd-grid-video-renderer a[href^="/shorts"]'),
            ...document.querySelectorAll('ytd-compact-video-renderer a[href^="/shorts"]'),
            ...document.querySelectorAll('ytd-video-renderer a[href^="/shorts"]')
        ];
        
        shortsContentElements.forEach(element => {
            try {
                const container = findShortsContainer(element);
                if (container) {
                    if (shortsHandling === 'block') {
                        container.classList.add('youdefine-shorts-blocked');
                        container.classList.remove('youdefine-converted-short');
                    } else {
                        container.classList.remove('youdefine-shorts-blocked');
                        container.classList.add('youdefine-converted-short');
                        const links = container.querySelectorAll('a[href^="/shorts"]');
                        links.forEach(link => {
                            const originalHref = link.getAttribute('href');
                            const newHref = originalHref.replace('/shorts/', '/watch?v=');
                            link.setAttribute('href', newHref);
                            const shortsLabels = link.querySelectorAll('span, yt-formatted-string');
                            shortsLabels.forEach(label => {
                                if (label.textContent && label.textContent.includes('Shorts')) {
                                    label.textContent = label.textContent.replace('Shorts', 'Video');
                                }
                            });
                        });
                        const thumbnails = container.querySelectorAll('ytd-thumbnail');
                        thumbnails.forEach(thumbnail => {
                            thumbnail.classList.remove('ytd-reel-video-renderer');
                            const img = thumbnail.querySelector('img');
                            if (img) {
                                img.style.borderRadius = '0';
                            }
                        });
                    }
                }
            } catch (elementError) {
                console.log("YouDefineTube: Error processing shorts content:", elementError);
            }
        });
        
        try {
            const shortsCarouselItems = document.querySelectorAll('ytd-reel-video-renderer');
            shortsCarouselItems.forEach(item => {
                if (shortsHandling === 'block') {
                    item.style.display = 'none';
                    item.classList.remove('youdefine-converted-short');
                } else {
                    item.style.display = '';
                    item.classList.add('youdefine-converted-short');
                    const videoId = extractVideoIdFromElement(item);
                    if (videoId) {
                        const existingOverlay = item.querySelector('.youdefine-convert-overlay');
                        if (existingOverlay) {
                            existingOverlay.remove();
                        }
                        const overlay = document.createElement('a');
                        overlay.href = `/watch?v=${videoId}`;
                        overlay.className = 'youdefine-convert-overlay';
                        overlay.textContent = 'Watch as normal video';
                        if (item.style.position !== 'relative' && 
                            window.getComputedStyle(item).position !== 'relative') {
                            item.style.position = 'relative';
                        }
                        item.appendChild(overlay);
                    }
                }
            });
        } catch (carouselError) {
            console.log("YouDefineTube: Error processing shorts carousel:", carouselError);
        }
    } catch (error) {
        console.log("YouDefineTube: Error in processYouTubeShorts:", error);
    }
}

// Helper to extract video ID from element
function extractVideoIdFromElement(element) {
    const shortsLink = element.querySelector('a[href^="/shorts/"]');
    if (shortsLink) {
        const href = shortsLink.getAttribute('href');
        const match = href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
            return match[1];
        }
    }
    
    if (element.data && element.data.videoId) {
        return element.data.videoId;
    }
    
    return null;
}

// Find the container of a shorts element
function findShortsContainer(element) {
    if (element.tagName === 'YTD-RICH-SECTION-RENDERER' || 
        element.tagName === 'YTD-REEL-SHELF-RENDERER') {
        return element;
    }
    
    const containers = [
        'ytd-grid-video-renderer',
        'ytd-compact-video-renderer',
        'ytd-video-renderer',
        'ytd-reel-item-renderer'
    ];
    
    for (const selector of containers) {
        const container = element.closest(selector);
        if (container) return container;
    }
    
    return null;
}

// Set up observer to process shorts that appear dynamically
function setupShortsObserver(shortsHandling) {
    const observer = new MutationObserver((mutations) => {
        let shouldProcess = false;
        
        mutations.forEach(mutation => {
            if (mutation.type === 'childList' && mutation.addedNodes.length) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList.contains('yt-simple-endpoint')) {
                            shouldProcess = true;
                            break;
                        }
                    }
                }
            }
        });
        
        if (shouldProcess) {
            processYouTubeShorts(shortsHandling);
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Function to fetch videos based on the selected topic
function fetchVideosByTopic(topic) {
    if (!apiKey) {
        console.warn('YouDefineTube: API key not available');
        displayFilteredContent([], topic, 'API key not set. Please set it in chrome.storage.local using: chrome.storage.local.set({ apiKey: "YOUR_API_KEY" }).');
        return;
    }
    
    if (videoCache[topic] && !force) {
        console.log(`YouDefineTube: Using cached results for "${topic}"`);
        displayFilteredContent(videoCache[topic], topic);
        return;
    }
    
    
    const searchQuery = `${encodeURIComponent(topic)} -shorts`;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${searchQuery}&key=${apiKey}&type=video&maxResults=30&videoDuration=medium`;

    fetch(url)
        .then((response) => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then((data) => {
            const videos = data.items
                .map((item) => ({
                    title: item.snippet.title,
                    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                    thumbnail: item.snippet.thumbnails.medium.url,
                    description: item.snippet.description,
                    videoId: item.id.videoId
                }))
                .filter(
                    (video) => 
                        (video.title.toLowerCase().includes(topic.toLowerCase()) ||
                        video.description.toLowerCase().includes(topic.toLowerCase())) &&
                        !video.title.toLowerCase().includes("#shorts") &&
                        !video.title.toLowerCase().includes("short") &&
                        !video.description.toLowerCase().includes("#shorts") &&
                        !video.url.includes("/shorts/")
                );

            videoCache[topic] = videos;
            displayFilteredContent(videos, topic);
        })
        .catch((error) => {
            console.error("YouDefineTube: Error fetching videos:", error);
            displayFilteredContent([], topic, 'Error fetching videos. Please check your API key and try again.');
        });
}

// Function to create and display filtered content
function displayFilteredContent(videos, topic, errorMessage = null) {
    const container = document.querySelector("ytd-rich-grid-renderer");
    const videoContainer = document.getElementById('video-container');
    const videoList = document.getElementById('video-list');
    
    if (!videoContainer || !videoList) return;

    if (isHomePage && container) {
        container.style.display = "block";
        const videoGrid = document.createElement("div");
        videoGrid.style.display = "grid";
        videoGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(200px, 1fr))";
        videoGrid.style.gap = "16px";
        videoGrid.style.padding = "16px";
        videoGrid.style.boxSizing = "border-box";

        if (errorMessage) {
            const errorDiv = document.createElement("div");
            errorDiv.style.gridColumn = "1 / -1";
            errorDiv.style.textAlign = "center";
            errorDiv.style.padding = "50px 20px";
            errorDiv.style.color = "#606060";
            errorDiv.innerHTML = `<h3>Error</h3><p>${errorMessage}</p>`;
            videoGrid.appendChild(errorDiv);
        } else if (videos.length === 0) {
            const noResults = document.createElement("div");
            noResults.style.gridColumn = "1 / -1";
            noResults.style.textAlign = "center";
            noResults.style.padding = "50px 20px";
            noResults.style.color = "#606060";
            noResults.innerHTML = `
                <h3>No results found for "${topic}"</h3>
                <p>Try a different topic or check your spelling.</p>
            `;
            videoGrid.appendChild(noResults);
        } else {
            videos.forEach((video) => {
                const videoElement = document.createElement("div");
                videoElement.style.backgroundColor = "#fff";
                videoElement.style.borderRadius = "8px";
                videoElement.style.overflow = "hidden";
                videoElement.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.1)";
                videoElement.style.cursor = "pointer";
                videoElement.style.transition = "transform 0.2s";

                videoElement.innerHTML = `
                    <a href="${video.url}" style="text-decoration: none; color: inherit;">
                        <img src="${video.thumbnail}" alt="${video.title}" style="width: 100%; height: auto; border-bottom: 1px solid #e0e0e0;" />
                        <div style="padding: 8px;">
                            <h4 style="margin: 0; font-size: 14px; line-height: 1.2;">${video.title}</h4>
                        </div>
                    </a>`;

                videoElement.addEventListener("mouseenter", () => {
                    videoElement.style.transform = "scale(1.02)";
                });
                videoElement.addEventListener("mouseleave", () => {
                    videoElement.style.transform = "scale(1)";
                });

                videoGrid.appendChild(videoElement);
            });
        }

        container.innerHTML = "";
        container.appendChild(videoGrid);
    }

    videoContainer.style.display = videos.length > 0 || errorMessage ? "block" : "none";
    videoList.innerHTML = errorMessage ? `<p>${errorMessage}</p>` : '';

    if (!errorMessage && videos.length > 0) {
        videos.forEach((video) => {
            const videoElement = document.createElement("div");
            videoElement.style.marginBottom = "10px";
            videoElement.innerHTML = `
                <h4 style="font-size: 14px; margin: 0;">${video.title}</h4>
                <p style="font-size: 12px; color: #666; margin: 5px 0;">${video.description.substring(0, 100)}...</p>
                <a href="${video.url}" target="_blank" style="font-size: 12px; color: #1a0dab;">Watch on YouTube</a>
            `;
            videoList.appendChild(videoElement);
        });
    }
}

// Function to clear topic content and restore default YouTube view
function clearTopicContent() {
    const container = document.querySelector("ytd-rich-grid-renderer");
    const videoContainer = document.getElementById('video-container');
    const videoList = document.getElementById('video-list');

    if (isHomePage && container) {
        container.style.display = "";
        container.innerHTML = "";
    }

    if (videoContainer && videoList) {
        videoContainer.style.display = "none";
        videoList.innerHTML = "";
    }
}

// Main function to handle YouTube page
function handleYouTubePage() {
    if (settings.activeTopic && settings.activeTopic !== lastFetchedTopic) {
        lastFetchedTopic = settings.activeTopic;
        fetchVideosByTopic(settings.activeTopic);
    }
    
    isHomePage = checkIfHomePage();
    injectYouDefineButton();

    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(['hideShorts', 'hideSidebar', 'hideComments', 'activeTopic'], function(settings) {
                if (chrome.runtime.lastError) {
                    console.warn('YouDefineTube: Error getting settings:', chrome.runtime.lastError);
                    return;
                }
                applySettings(settings || {});
                if (settings.activeTopic) {
                    fetchVideosByTopic(settings.activeTopic);
                } else {
                    clearTopicContent();
                }
            });
        } else {
            console.warn('YouDefineTube: Chrome storage API not available');
            applySettings({
                hideShorts: false,
                hideSidebar: false,
                hideComments: false
            });
        }
    } catch (error) {
        console.warn('YouDefineTube: Error accessing storage API:', error);
        applySettings({
            hideShorts: false,
            hideSidebar: false,
            hideComments: false
        });
    }

    console.log("YouDefineTube: Page type check. Is homepage?", isHomePage);
}

// Set up the MutationObserver to handle YouTube SPA navigation
function setupObserver() {
    const observer = new MutationObserver((mutations) => {
        window.requestAnimationFrame(() => {
            let significantChange = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                    significantChange = true;
                    break;
                }
                if (mutation.type === 'attributes' && mutation.attributeName === 'page-subtype' && mutation.target.tagName === 'YTD-BROWSE') {
                    significantChange = true;
                    break;
                }
            }

            if (significantChange) {
                handleYouTubePage();
            }
        });
    });

    const appElement = document.querySelector('ytd-app');
    if (appElement) {
        observer.observe(appElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['page-subtype']
        });
    } else if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }
}

// Initial Check Logic
if (document.documentElement) {
    handleYouTubePage();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        handleYouTubePage();
        setupObserver();
    });
} else {
    handleYouTubePage();
    setupObserver();
}

window.addEventListener('yt-navigate-start', () => {});
window.addEventListener('yt-navigate-finish', () => {
    window.requestAnimationFrame(() => {
        handleYouTubePage();
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateSettings') {
        console.log("YouDefineTube: Received updateSettings message");
        handleYouTubePage();
        loadStoredSettings();
        sendResponse({ status: "Settings received by content script" });
    }
    return true;
});

console.log("YouDefineTube: Content script loaded.");