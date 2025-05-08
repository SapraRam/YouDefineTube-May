/* global chrome */

// Track if we're on the homepage
let isHomePage = false;
let lastFetchedTopic = null;
let lastRenderedTopic = null; // Track the last topic for which videos were rendered
let lastHomePageState = null; // Track the last homepage state to detect changes
let lastKnownTopics = []; // Cache the last known topics for fallback rendering
let lastKnownActiveTopic = ''; // Cache the last known active topic

// Track our custom button and panel
let youdefineButton = null;
let youdefinePanel = null;
let isPanelVisible = false;

// Track the containers
let topicInputContainer = null;
let navMessageContainer = null;
let contentContainer = null;
let topicNavContainer = null;
let noTopicsMessageContainer = null;

// Flag to track YouTube logo clicks
let youtubeLogoClicked = false;

// YouTube API key (replace with your actual API key)
const API_KEY = 'AIzaSyCUWbnQGIlQalfCit_cOfhcXVu3O_qZl-o'; // Replace this with your actual YouTube Data API key

// Cache for fetched videos by topic
const videoCache = {};

// Debounce function to limit how often handleYouTubePage is called
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Function to check if we're on the YouTube homepage with retry mechanism
function checkIfHomePage(retryCount = 0, maxRetries = 5) {
    if (window.location.pathname === '/' || window.location.pathname === '/feed/recommended') {
        return true;
    }
    const browseElement = document.querySelector('ytd-browse');
    if (browseElement && browseElement.getAttribute('page-subtype') === 'home') {
        return true;
    }
    // Retry if homepage not detected and retry limit not reached
    if (retryCount < maxRetries) {
        setTimeout(() => checkIfHomePage(retryCount + 1, maxRetries), 50);
    }
    return false;
}

// Function to inject our custom button next to the Create button
function injectYouDefineButton() {
    if (document.getElementById('youdefine-button')) return;
    
    const endButtonsContainer = document.querySelector('ytd-masthead #end');
    if (!endButtonsContainer) {
        setTimeout(injectYouDefineButton, 1000);
        return;
    }
    
    youdefineButton = document.createElement('button');
    youdefineButton.id = 'youdefine-button';
    youdefineButton.innerHTML = '<img src="' + chrome.runtime.getURL('images/icon16.png') + '" alt="YouDefineTube"> YouDefineTube';
    
    youdefinePanel = document.createElement('div');
    youdefinePanel.id = 'youdefine-panel';
    youdefinePanel.innerHTML = `        
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
}

// Function to fetch videos from the YouTube Data API
async function fetchVideos(query) {
    // Check if videos are already cached
    if (videoCache[query]) {
        console.log(`Using cached videos for topic: ${query}`);
        return videoCache[query];
    }

    console.log(`Fetching videos for topic: ${query}`);
    const maxResults = 30;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${maxResults}&q=${encodeURIComponent(query)}&key=${API_KEY}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const videos = data.items || [];
        // Cache the videos
        videoCache[query] = videos;
        return videos;
    } catch (error) {
        console.error('Error fetching videos:', error);
        return [];
    }
}

// Function to render the video grid in the content container
function renderVideoGrid(videos, topic) {
    if (!contentContainer) return;

    // Only clear and re-render if the topic has changed
    if (lastRenderedTopic !== topic) {
        contentContainer.innerHTML = '';

        if (videos.length === 0) {
            contentContainer.innerHTML = '<p>No videos found.</p>';
            return;
        }

        // Create a grid structure similar to YouTube's homepage
        const gridRenderer = document.createElement('div');
        gridRenderer.className = 'ytd-rich-grid-renderer style-scope';
        gridRenderer.innerHTML = `
            <div id="contents" class="style-scope ytd-rich-grid-renderer">
                <div id="content" class="ytd-rich-grid-renderer style-scope">
                </div>
            </div>
        `;
        const contentDiv = gridRenderer.querySelector('#content');

        videos.forEach(video => {
            const videoId = video.id.videoId;
            const title = video.snippet.title;
            const thumbnail = video.snippet.thumbnails.medium.url;
            const channelTitle = video.snippet.channelTitle;
            const publishedAt = video.snippet.publishedAt;

            // Create a video item similar to YouTube's structure
            const videoItem = document.createElement('div');
            videoItem.className = 'ytd-rich-item-renderer style-scope';
            videoItem.innerHTML = `
                <div id="content" class="ytd-rich-item-renderer style-scope">
                    <ytd-video-renderer class="style-scope ytd-rich-grid-renderer">
                        <div id="dismissible" class="style-scope ytd-video-renderer">
                            <ytd-thumbnail class="style-scope ytd-video-renderer">
                                <a id="thumbnail" class="yt-simple-endpoint inline-block style-scope ytd-thumbnail" href="/watch?v=${videoId}">
                                    <img id="img" class="style-scope ytd-thumbnail" src="${thumbnail}" alt="${title}" width="360" height="202">
                                </a>
                            </ytd-thumbnail>
                            <div id="details" class="style-scope ytd-video-renderer">
                                <div id="meta" class="style-scope ytd-video-renderer">
                                    <h3 class="style-scope ytd-video-renderer">
                                        <a id="video-title" class="yt-simple-endpoint style-scope ytd-video-renderer" href="/watch?v=${videoId}">
                                            ${title}
                                        </a>
                                    </h3>
                                    <div id="metadata" class="style-scope ytd-video-renderer">
                                        <div id="byline-container" class="style-scope ytd-video-renderer">
                                            <span id="channel-name" class="style-scope ytd-video-renderer">
                                                <a class="yt-simple-endpoint style-scope ytd-video-renderer" href="/channel/${video.snippet.channelId}">
                                                    ${channelTitle}
                                                </a>
                                            </span>
                                        </div>
                                        <div id="metadata-line" class="style-scope ytd-video-renderer">
                                            <span class="style-scope ytd-video-renderer">
                                                ${new Date(publishedAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ytd-video-renderer>
                </div>
            `;
            contentDiv.appendChild(videoItem);
        });

        contentContainer.appendChild(gridRenderer);
        lastRenderedTopic = topic;
    }
}

// Function to inject all homepage elements with retry mechanism
function injectHomePageElements(retryCount = 0, maxRetries = 5) {
    // Check if we're on the homepage
    isHomePage = checkIfHomePage();
    if (!isHomePage) {
        if (retryCount < maxRetries) {
            setTimeout(() => injectHomePageElements(retryCount + 1, maxRetries), 500);
        }
        return;
    }

    const primaryContent = document.querySelector('ytd-browse[page-subtype="home"] #primary');
    if (!primaryContent) {
        if (retryCount < maxRetries) {
            setTimeout(() => injectHomePageElements(retryCount + 1, maxRetries), 500);
        }
        return;
    }

    // Inject the topic input container (first div)
    if (!document.getElementById('youdefine-topic-input-container')) {
        topicInputContainer = document.createElement('div');
        topicInputContainer.id = 'youdefine-topic-input-container';
        topicInputContainer.className = 'youdefine-topic-input-container';
        topicInputContainer.innerHTML = `
            <div class="input-wrapper">
                <input type="text" id="topic-input" placeholder="Add a topic, e.g., JavaScript, guitar lessons, history" autocomplete="off" autofocus>
                <button id="add-topic-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
            </div>
        `;
        primaryContent.insertBefore(topicInputContainer, primaryContent.firstChild);

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
    }

    // Inject the nav/message container (second div)
    if (!document.getElementById('youdefine-nav-message-container')) {
        navMessageContainer = document.createElement('div');
        navMessageContainer.id = 'youdefine-nav-message-container';
        navMessageContainer.className = 'youdefine-nav-message-container';
        
        // Add the "no topics" message container
        noTopicsMessageContainer = document.createElement('div');
        noTopicsMessageContainer.id = 'youdefine-no-topics-message';
        noTopicsMessageContainer.className = 'youdefine-no-topics-message';
        noTopicsMessageContainer.textContent = 'No topics added yet. Add a topic above to get started!';
        navMessageContainer.appendChild(noTopicsMessageContainer);

        // Add the topic chips nav bar container
        topicNavContainer = document.createElement('div');
        topicNavContainer.id = 'youdefine-topic-nav';
        topicNavContainer.className = 'youdefine-topic-nav';
        navMessageContainer.appendChild(topicNavContainer);

        primaryContent.insertBefore(navMessageContainer, topicInputContainer.nextSibling);
    }

    // Inject the content container (third div)
    if (!document.getElementById('youdefine-content-container')) {
        contentContainer = document.createElement('div');
        contentContainer.id = 'youdefine-content-container';
        contentContainer.className = 'youdefine-content-container';
        primaryContent.insertBefore(contentContainer, navMessageContainer.nextSibling);
    }

    // Render the nav bar with the last known topics
    if (lastKnownTopics.length === 0) {
        document.body.classList.remove('has-topics');
        noTopicsMessageContainer.style.display = 'block';
        topicNavContainer.style.display = 'none';
    } else {
        document.body.classList.add('has-topics');
        noTopicsMessageContainer.style.display = 'none';
        topicNavContainer.style.display = 'flex';

        const existingChips = Array.from(topicNavContainer.querySelectorAll('.youdefine-topic-chip'));
        const existingChipNames = existingChips.map(chip => chip.querySelector('.chip-name').textContent);

        existingChips.forEach(chip => {
            const chipName = chip.querySelector('.chip-name').textContent;
            if (!lastKnownTopics.includes(chipName)) {
                chip.remove();
            }
        });

        lastKnownTopics.forEach(topic => {
            if (!existingChipNames.includes(topic)) {
                const chip = document.createElement('div');
                chip.className = 'youdefine-topic-chip';
                if (topic === lastKnownActiveTopic) {
                    chip.classList.add('active-chip');
                }

                const chipName = document.createElement('span');
                chipName.className = 'chip-name';
                chipName.textContent = topic;
                chipName.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setActiveTopic(topic);
                });

                const closeBtn = document.createElement('span');
                closeBtn.className = 'chip-close';
                closeBtn.textContent = '×';
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    removeTopic(topic);
                });

                chip.appendChild(chipName);
                chip.appendChild(closeBtn);
                topicNavContainer.appendChild(chip);
            } else {
                const chip = existingChips.find(c => c.querySelector('.chip-name').textContent === topic);
                if (chip) {
                    if (topic === lastKnownActiveTopic) {
                        chip.classList.add('active-chip');
                    } else {
                        chip.classList.remove('active-chip');
                    }
                }
            }
        });
    }
}

// Function to update topic chips navigation bar on the homepage (used after storage fetch)
function updateTopicChipsNav(topics, activeTopic) {
    if (!isHomePage) return;

    if (!navMessageContainer || !topicNavContainer || !noTopicsMessageContainer) {
        injectHomePageElements();
        return;
    }

    // Toggle visibility between the message and nav bar
    if (topics.length === 0) {
        document.body.classList.remove('has-topics');
        noTopicsMessageContainer.style.display = 'block';
        topicNavContainer.style.display = 'none';
        return;
    } else {
        document.body.classList.add('has-topics');
        noTopicsMessageContainer.style.display = 'none';
        topicNavContainer.style.display = 'flex';
    }

    // Get current chips in the DOM
    const existingChips = Array.from(topicNavContainer.querySelectorAll('.youdefine-topic-chip'));
    const existingChipNames = existingChips.map(chip => chip.querySelector('.chip-name').textContent);

    // Remove chips that no longer exist in the topics list
    existingChips.forEach(chip => {
        const chipName = chip.querySelector('.chip-name').textContent;
        if (!topics.includes(chipName)) {
            chip.remove();
        }
    });

    // Add or update chips based on the topics list
    topics.forEach(topic => {
        if (!existingChipNames.includes(topic)) {
            // Add new chip
            const chip = document.createElement('div');
            chip.className = 'youdefine-topic-chip';
            if (topic === activeTopic) {
                chip.classList.add('active-chip');
            }

            // Create chip content
            const chipName = document.createElement('span');
            chipName.className = 'chip-name';
            chipName.textContent = topic;
            chipName.addEventListener('click', (e) => {
                e.stopPropagation();
                setActiveTopic(topic);
            });

            // Create close button
            const closeBtn = document.createElement('span');
            closeBtn.className = 'chip-close';
            closeBtn.textContent = '×';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeTopic(topic);
            });

            chip.appendChild(chipName);
            chip.appendChild(closeBtn);
            topicNavContainer.appendChild(chip);
        } else {
            // Update existing chip's active state
            const chip = existingChips.find(c => c.querySelector('.chip-name').textContent === topic);
            if (chip) {
                if (topic === activeTopic) {
                    chip.classList.add('active-chip');
                } else {
                    chip.classList.remove('active-chip');
                }
            }
        }
    });
}

// Toggle panel visibility
function togglePanel() {
    isPanelVisible = !isPanelVisible;
    if (isPanelVisible) {
        youdefinePanel.classList.add('visible');
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
        return;
    }

    try {
        chrome.storage.sync.get(['topics', 'activeTopic'], function(data) {
            if (chrome.runtime.lastError) {
                return;
            }

            const topics = data.topics || [];
            const activeTopic = data.activeTopic || '';

            // Cache the topics and active topic for fallback rendering
            lastKnownTopics = topics;
            lastKnownActiveTopic = activeTopic;

            // Update topic chips navigation bar
            updateTopicChipsNav(topics, activeTopic);

            // Set has-topics class immediately
            if (topics.length > 0) {
                document.body.classList.add('has-topics');
            } else {
                document.body.classList.remove('has-topics');
            }

            if (activeTopic && activeTopic !== lastFetchedTopic) {
                setActiveTopic(activeTopic);
            } else if (!activeTopic && isHomePage) {
                clearTopicContent();
            }
        });
    
        chrome.storage.sync.get(['hideShorts', 'hideSidebar', 'hideComments', 'shortsHandling'], function(data) {
            if (chrome.runtime.lastError) {
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
    } catch (error) {}
}

// Add a new topic and fetch videos immediately
async function addTopic(inputElement) {
    const topic = inputElement.value.trim();
    
    inputElement.style.borderColor = '';
    
    if (!topic) {
        inputElement.style.borderColor = '#ff0000';
        inputElement.classList.add('shake-animation');
        setTimeout(() => {
            inputElement.classList.remove('shake-animation');
        }, 500);
        return;
    }
    
    chrome.storage.sync.get(['topics'], async function(data) {
        const topics = data.topics || [];
        
        if (!topics.includes(topic)) {
            // Fetch videos for the new topic immediately
            await fetchVideos(topic);
            
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
        
        // Remove the topic from the cache
        if (videoCache[topicToRemove]) {
            delete videoCache[topicToRemove];
        }
        
        chrome.storage.sync.set({ 'topics': updatedTopics }, function() {
            if (topicToRemove === activeTopic) {
                chrome.storage.sync.set({ 'activeTopic': '' }, function() {
                    loadStoredSettings();
                });
            } else {
                loadStoredSettings();
            }
        });
    });
}

// Set active topic and display cached videos
function setActiveTopic(topic) {
    if (topic === lastFetchedTopic) return;

    lastFetchedTopic = topic;
    chrome.storage.sync.set({ 'activeTopic': topic }, function() {
        chrome.storage.sync.get(['topics'], function(data) {
            const topics = data.topics || [];
            updateTopicChipsNav(topics, topic);
            if (!topic) {
                clearTopicContent();
            } else {
                // Use cached videos, no fetch here
                const videos = videoCache[topic] || [];
                renderVideoGrid(videos, topic);
            }
        });
    });
}

// Save display settings
function saveDisplaySettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
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
            if (chrome.runtime.lastError) {
                applySettings(settings);
                if (hideShorts) {
                    applyShortsHandling();
                }
                return;
            }
            
            const shortsHandling = data.shortsHandling || 'block';
            
            chrome.storage.sync.set(settings, function() {
                if (chrome.runtime.lastError) {
                    return;
                }
                
                applySettings(settings);
                
                if (hideShorts) {
                    applyShortsHandling();
                }
            });
        });
    } catch (error) {
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
        processYouTubeShorts('block');
        return;
    }
    
    try {
        chrome.storage.sync.get(['hideShorts', 'shortsHandling'], function(data) {
            if (chrome.runtime.lastError) {
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
            } catch (selectorError) {}
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
            } catch (elementError) {}
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
        } catch (carouselError) {}
    } catch (error) {}
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

// Function to clear topic content and restore default YouTube view
function clearTopicContent() {
    if (contentContainer) {
        contentContainer.innerHTML = '<p>Select a topic to see videos.</p>';
        lastRenderedTopic = null;
    }
}

// Main function to handle YouTube page
function handleYouTubePage() {
    const currentHomePageState = checkIfHomePage();
    
    // Always proceed on the homepage, regardless of previous state
    isHomePage = currentHomePageState;
    lastHomePageState = currentHomePageState;
    
    if (isHomePage) {
        // Inject the custom button
        injectYouDefineButton();
        
        // Inject all homepage elements
        injectHomePageElements();

        // Fetch the latest settings and update the nav bar
        loadStoredSettings();
    } else {
        injectYouDefineButton();
        loadStoredSettings();
    }

    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(['hideShorts', 'hideSidebar', 'hideComments', 'activeTopic'], function(settings) {
                if (chrome.runtime.lastError) return;
                
                applySettings(settings || {});
                
                if (settings.activeTopic && settings.activeTopic !== lastFetchedTopic) {
                    setActiveTopic(settings.activeTopic);
                } else if (isHomePage && !settings.activeTopic) {
                    clearTopicContent();
                }
            });
        } else {
            applySettings({
                hideShorts: false,
                hideSidebar: false,
                hideComments: false
            });
        }
    } catch (error) {
        applySettings({
            hideShorts: false,
            hideSidebar: false,
            hideComments: false
        });
    }
}

// Debounced version of handleYouTubePage
const debouncedHandleYouTubePage = debounce(handleYouTubePage, 300);

// Set up the MutationObserver to handle YouTube SPA navigation
function setupObserver() {
    const observer = new MutationObserver((mutations) => {
        let significantChange = false;
        for (const mutation of mutations) {
            // Only trigger on specific changes to reduce unnecessary calls
            if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'YTD-BROWSE') {
                        significantChange = true;
                        break;
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'YTD-BROWSE') {
                        significantChange = true;
                        break;
                    }
                }
            }
            if (mutation.type === 'attributes' && mutation.attributeName === 'page-subtype' && mutation.target.tagName === 'YTD-BROWSE') {
                significantChange = true;
                break;
            }
        }

        if (significantChange) {
            window.requestAnimationFrame(() => {
                debouncedHandleYouTubePage();
            });
        }
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
    
    // Add specific detection for YouTube logo clicks
    setupYouTubeLogoClickDetection();
}

// Setup YouTube logo click detection
function setupYouTubeLogoClickDetection() {
    // Watch for YouTube logo clicks
    const logoInterval = setInterval(() => {
        const ytLogo = document.querySelector('ytd-masthead a#logo');
        if (ytLogo) {
            ytLogo.addEventListener('click', () => {
                youtubeLogoClicked = true;
                // Trigger handleYouTubePage immediately
                handleYouTubePage();
            });
            clearInterval(logoInterval);
        }
    }, 500);
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
        debouncedHandleYouTubePage();
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateSettings') {
        handleYouTubePage();
        loadStoredSettings();
        sendResponse({ status: "Settings received by content script" });
    }
    return true;
});