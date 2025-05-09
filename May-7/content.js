/* global chrome */

// Track if we're on the homepage
let isHomePage = false;
let lastFetchedTopic = null;
let lastRenderedTopic = null;
let lastHomePageState = null;
let lastKnownTopics = [];
let lastKnownActiveTopic = '';
let youtubeLogoClicked = false;

// Track our custom elements
let youdefineButton = null;
let youdefinePanel = null;
let isPanelVisible = false;
let topicInputContainer = null;
let navMessageContainer = null;
let contentContainer = null;
let topicNavContainer = null;
let noTopicsMessageContainer = null;

// YouTube API key
const API_KEY = 'AIzaSyDZPrC4WYznFS0Zwt-MNmVLPm5LjdxHtcI';
const videoCache = {};

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Check if we're on the YouTube homepage
function checkIfHomePage(retryCount = 0, maxRetries = 5) {
    if (window.location.pathname === '/' || window.location.pathname === '/feed/recommended') {
        return true;
    }
    const browseElement = document.querySelector('ytd-browse');
    if (browseElement && browseElement.getAttribute('page-subtype') === 'home') {
        return true;
    }
    if (retryCount < maxRetries) {
        setTimeout(() => checkIfHomePage(retryCount + 1, maxRetries), 50);
    }
    return false;
}

// Inject custom button
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

    youdefineButton.addEventListener('click', function (e) {
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

// Fetch videos from YouTube API
async function fetchVideos(query) {
    if (videoCache[query]) {
        console.log(`Using cached videos for topic: ${query}`);
        return videoCache[query];
    }

    console.log(`Fetching videos for topic: ${query}`);
    const maxResults = 30;
    
    // Add '-shorts' to exclude shorts from the search results
    const searchQuery = `${encodeURIComponent(query)} -shorts`;
    
    // Added videoDuration=medium to further filter out short videos
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${maxResults}&q=${searchQuery}&videoDuration=medium&order=relevance&key=${API_KEY}`;

    try {
        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) {
            throw new Error(`HTTP error! status: ${searchResponse.status}`);
        }
        const searchData = await searchResponse.json();
        
        // Additional filtering to ensure no shorts videos make it through
        // Also transforms the data into a more usable format
        let videos = (searchData.items || [])
            .map(item => ({
                id: { videoId: item.id.videoId },
                snippet: item.snippet,
                title: item.snippet.title,
                url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                thumbnail: item.snippet.thumbnails.medium.url,
                description: item.snippet.description,
                videoId: item.id.videoId,
                publishedAt: item.snippet.publishedAt,
                channelId: item.snippet.channelId,
                channelTitle: item.snippet.channelTitle
            }))
            .filter(video => 
                // Ensure the video relates to the topic
                (video.title.toLowerCase().includes(query.toLowerCase()) || 
                video.description.toLowerCase().includes(query.toLowerCase())) && 
                // Filter out potential shorts
                !video.title.toLowerCase().includes("#shorts") && 
                !video.title.toLowerCase().includes("short") && 
                !video.description.toLowerCase().includes("#shorts") &&
                // Exclude videos with /shorts/ URL
                !video.url.includes("/shorts/")
            );
        
        console.log(`Found ${videos.length} filtered videos for topic: ${query}`);
        
        // Try to fetch video durations to enhance the data
        try {
            videos = await fetchVideoDurations(videos);
        } catch (durationError) {
            console.warn('Could not fetch video durations:', durationError);
        }
        
        videoCache[query] = videos;
        
        // Save the enhanced videos to storage to persist them across page reloads
        saveVideoCacheToStorage(query, videos);
        
        return videos;
    } catch (error) {
        console.error(`Error fetching videos for query "${query}":`, error);
        return [];
    }
}

// Render video grid
function renderVideoGrid(videos, topic) {
    if (!contentContainer) return;
    
    // Don't re-render if the content for this topic is already displayed
    if (lastRenderedTopic === topic && contentContainer.querySelector('.youdefine-content-grid')) {
        return;
    }
    
    // Only clear and rebuild when the topic changes
    contentContainer.innerHTML = '';

    if (videos.length === 0) {
        contentContainer.innerHTML = '<p class="no-videos-message">No videos found for this topic.</p>';
        return;
    }

    // Create a header for the topic section
    const topicHeader = document.createElement('div');
    topicHeader.className = 'youdefine-topic-header';
    topicHeader.innerHTML = `<h2>${topic}</h2>`;
    contentContainer.appendChild(topicHeader);

    const gridRenderer = document.createElement('div');
    gridRenderer.className = 'ytd-rich-grid-renderer youdefine-content-grid';
    gridRenderer.id = 'youdefine-grid-' + topic.replace(/\s+/g, '-').toLowerCase();
    
    videos.forEach(video => {
        try {
            // Support both the new format and the old format
            const videoId = video.videoId || (video.id && video.id.videoId);
            let title, thumbnail, channelTitle, publishedAt, channelId;
            
            // Handle different video object structures
            if (video.snippet) {
                title = video.title || video.snippet.title;
                thumbnail = video.thumbnail || 
                           (video.snippet.thumbnails.high ? video.snippet.thumbnails.high.url : 
                           (video.snippet.thumbnails.medium ? video.snippet.thumbnails.medium.url : 
                           video.snippet.thumbnails.default.url));
                channelTitle = video.channelTitle || video.snippet.channelTitle;
                publishedAt = video.publishedAt || video.snippet.publishedAt;
                channelId = video.channelId || video.snippet.channelId;
            } else {
                // Use direct properties if snippet is not available
                title = video.title;
                thumbnail = video.thumbnail;
                channelTitle = video.channelTitle;
                publishedAt = video.publishedAt;
                channelId = video.channelId;
            }
            
            const timeAgo = getTimeAgo(new Date(publishedAt));

            // Create a short description preview if available
            const description = video.description ? 
                (video.description.length > 100 ? 
                video.description.substring(0, 100) + '...' : 
                video.description) : '';            const videoItem = document.createElement('div');
            videoItem.className = 'ytd-rich-item-renderer';
            videoItem.innerHTML = `
                <div class="ytd-rich-item-content">
                    <div class="thumbnail-container">
                        <a href="/watch?v=${videoId}" class="yt-simple-endpoint">
                            <img class="thumbnail" src="${thumbnail}" alt="${title}" loading="lazy">
                            <div class="overlay">
                                <span class="duration-badge">${video.duration || 'N/A'}</span>
                            </div>
                        </a>
                    </div>
                    <div class="details">
                        <a href="/watch?v=${videoId}" class="video-title-link">
                            <h3 class="video-title">${title}</h3>
                        </a>
                        <div class="metadata">
                            <a href="/channel/${channelId}" class="channel-link">${channelTitle}</a>
                            <div class="metadata-stats">
                                <span class="time-ago">${timeAgo}</span>
                            </div>
                        </div>
                        ${description ? `<div class="video-description">${description}</div>` : ''}
                    </div>
                </div>
            `;
            gridRenderer.appendChild(videoItem);
        } catch (err) {
            console.error('Error rendering video:', err, video);
        }
    });

    contentContainer.appendChild(gridRenderer);
    
    lastRenderedTopic = topic;
}

// Helper function to format time ago
function getTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) {
        return diffInSeconds + ' seconds ago';
    }
    
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
        return diffInMinutes + ' minutes ago';
    }
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
        return diffInHours + ' hours ago';
    }
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) {
        return diffInDays + ' days ago';
    }
    
    const diffInWeeks = Math.floor(diffInDays / 7);
    if (diffInWeeks < 4) {
        return diffInWeeks + ' weeks ago';
    }
    
    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) {
        return diffInMonths + ' months ago';
    }
    
    const diffInYears = Math.floor(diffInDays / 365);
    return diffInYears + ' years ago';
}

// Inject homepage elements
function injectHomePageElements(retryCount = 0, maxRetries = 5) {
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

    // Persist topic input container
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

    // Persist nav/message container
    if (!document.getElementById('youdefine-nav-message-container')) {
        navMessageContainer = document.createElement('div');
        navMessageContainer.id = 'youdefine-nav-message-container';
        navMessageContainer.className = 'youdefine-nav-message-container';

        noTopicsMessageContainer = document.createElement('div');
        noTopicsMessageContainer.id = 'youdefine-no-topics-message';
        noTopicsMessageContainer.className = 'youdefine-no-topics-message';
        navMessageContainer.appendChild(noTopicsMessageContainer);

        topicNavContainer = document.createElement('div');
        topicNavContainer.id = 'youdefine-topic-nav';
        topicNavContainer.className = 'youdefine-topic-nav';
        navMessageContainer.appendChild(topicNavContainer);

        primaryContent.insertBefore(navMessageContainer, topicInputContainer.nextSibling);
    }

    // Persist content container
    if (!document.getElementById('youdefine-content-container')) {
        contentContainer = document.createElement('div');
        contentContainer.id = 'youdefine-content-container';
        contentContainer.className = 'youdefine-content-container';
        primaryContent.insertBefore(contentContainer, navMessageContainer.nextSibling);
    }

    // Render nav bar
    renderTopicChipsNav();
}

// Render topic chips navigation
function renderTopicChipsNav() {
    if (!topicNavContainer || !noTopicsMessageContainer) return;    if (lastKnownTopics.length === 0) {
        if (document.body) document.body.classList.remove('has-topics');
        noTopicsMessageContainer.style.display = 'block';
        topicNavContainer.style.display = 'none';
    } else {
        if (document.body) document.body.classList.add('has-topics');
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

                const closeBtn = document.createElement('span');
                closeBtn.className = 'chip-close';
                closeBtn.textContent = '×';
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    removeTopic(topic);
                });

                chip.appendChild(chipName);
                chip.appendChild(closeBtn);
                chip.addEventListener('click', (e) => {
                    if (e.target !== closeBtn) {
                        setActiveTopic(topic);
                    }
                });

                topicNavContainer.appendChild(chip); // Append to end
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

// Update topic chips navigation
function updateTopicChipsNav(topics, activeTopic) {
    if (!isHomePage) return;

    lastKnownTopics = topics;
    lastKnownActiveTopic = activeTopic;

    if (!navMessageContainer || !topicNavContainer || !noTopicsMessageContainer) {
        injectHomePageElements();
        return;
    }    if (topics.length === 0) {
        if (document.body) document.body.classList.remove('has-topics');
        noTopicsMessageContainer.style.display = 'block';
        topicNavContainer.style.display = 'none';
        clearTopicContent();
        return;
    } else {
        if (document.body) document.body.classList.add('has-topics');
        noTopicsMessageContainer.style.display = 'none';
        topicNavContainer.style.display = 'flex';
    }

    renderTopicChipsNav();

    if (activeTopic && activeTopic !== lastFetchedTopic) {
        setActiveTopic(activeTopic);
    }
}

// Toggle panel
function togglePanel() {
    isPanelVisible = !isPanelVisible;
    chrome.storage.sync.set({ 'panelVisible': isPanelVisible }, () => {
        if (isPanelVisible) {
            youdefinePanel.classList.add('visible');
            setTimeout(() => {
                document.addEventListener('click', handleClickOutside);
            }, 10);
        } else {
            youdefinePanel.classList.remove('visible');
            document.removeEventListener('click', handleClickOutside);
        }
    });
}

// Handle clicks outside panel
function handleClickOutside(event) {
    if (youdefinePanel && youdefineButton && !youdefinePanel.contains(event.target) && !youdefineButton.contains(event.target)) {
        isPanelVisible = false;
        chrome.storage.sync.set({ 'panelVisible': isPanelVisible }, () => {
            youdefinePanel.classList.remove('visible');
            document.removeEventListener('click', handleClickOutside);
        });
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
        hideShorts.addEventListener('change', function () {
            if (shortsOptions) {
                shortsOptions.style.display = this.checked ? 'block' : 'none';
            }
            saveDisplaySettings();
        });
    }

    if (shortsBlock) shortsBlock.addEventListener('change', saveShortsHandling);
    if (shortsConvert) shortsConvert.addEventListener('change', saveShortsHandling);
    if (hideSidebar) hideSidebar.addEventListener('change', saveDisplaySettings);
    if (hideComments) hideComments.addEventListener('change', saveDisplaySettings);
}

// Load stored settings
async function loadStoredSettings() {
    if (!chrome.storage || !chrome.storage.sync) return;

    chrome.storage.sync.get(['topics', 'activeTopic', 'panelVisible'], async function (data) {
        if (chrome.runtime.lastError) return;

        const topics = data.topics || [];
        const activeTopic = data.activeTopic || '';
        const storedPanelVisible = data.panelVisible || false;

        lastKnownTopics = topics;
        lastKnownActiveTopic = activeTopic;

        updateTopicChipsNav(topics, activeTopic);        if (topics.length > 0) {
            if (document.body) document.body.classList.add('has-topics');
        } else {
            if (document.body) document.body.classList.remove('has-topics');
        }

        // Only update panel visibility if it was explicitly set
        if (youdefinePanel && storedPanelVisible !== isPanelVisible) {
            isPanelVisible = storedPanelVisible;
            if (isPanelVisible) {
                youdefinePanel.classList.add('visible');
                document.addEventListener('click', handleClickOutside);
            } else {
                youdefinePanel.classList.remove('visible');
                document.removeEventListener('click', handleClickOutside);
            }
        }

        if (isHomePage) {
            if (activeTopic) {
                if (activeTopic !== lastFetchedTopic) {
                    // First check memory cache
                    if (videoCache[activeTopic]) {
                        renderVideoGrid(videoCache[activeTopic], activeTopic);
                        lastFetchedTopic = activeTopic;
                    } else {
                        // Then check storage
                        const storedVideos = await loadVideoCacheFromStorage(activeTopic);
                        if (storedVideos && storedVideos.length > 0) {
                            renderVideoGrid(storedVideos, activeTopic);
                            lastFetchedTopic = activeTopic;
                        } else {
                            // Finally, fetch from API
                            setActiveTopic(activeTopic);
                        }
                    }
                }
            } else {
                clearTopicContent();
            }
        }
    });

    chrome.storage.sync.get(['hideShorts', 'hideSidebar', 'hideComments', 'shortsHandling'], function (data) {
        if (chrome.runtime.lastError) return;

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
        if (data.hideShorts) applyShortsHandling();
    });
}

// Add a new topic
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

    chrome.storage.sync.get(['topics'], async function (data) {
        const topics = data.topics || [];

        if (!topics.includes(topic)) {
            await fetchVideos(topic);
            topics.push(topic); // Append to end
            chrome.storage.sync.set({ 'topics': topics, 'activeTopic': topic }, function () {
                inputElement.value = '';
                loadStoredSettings();
                setActiveTopic(topic);
            });
        } else {
            inputElement.value = '';
            setActiveTopic(topic);
        }
    });
}

// Remove a topic
function removeTopic(topicToRemove) {
    chrome.storage.sync.get(['topics', 'activeTopic'], function (data) {
        let topics = data.topics || [];
        const activeTopic = data.activeTopic || '';

        // Find index of the topic to be removed
        const removedIndex = topics.indexOf(topicToRemove);
        
        // Remove the topic
        topics = topics.filter(topic => topic !== topicToRemove);

        // Keep the video cache in memory for potential future use
        // This will allow us to reuse cached videos if the topic is added again
        console.log(`Keeping cached videos for removed topic: ${topicToRemove} for future use`);

        // Logic for selecting new active topic
        let newActiveTopic = activeTopic;

        // If we removed the active topic, select a neighboring topic
        if (topicToRemove === activeTopic) {
            if (topics.length > 0) {
                // Try to select the next topic in the list (neighboring topic)
                // If the removed topic was the last one, select the new last topic
                const nextIndex = Math.min(removedIndex, topics.length - 1);
                newActiveTopic = topics[nextIndex];
                console.log(`Selected neighboring topic: ${newActiveTopic}`);
            } else {
                newActiveTopic = '';
            }
        }

        chrome.storage.sync.set({ 'topics': topics, 'activeTopic': newActiveTopic }, function () {
            loadStoredSettings();
            if (newActiveTopic) {
                setActiveTopic(newActiveTopic);
            } else {
                clearTopicContent();
            }
        });
    });
}

// Set active topic
async function setActiveTopic(topic) {
    if (topic === lastFetchedTopic && videoCache[topic]) {
        renderVideoGrid(videoCache[topic], topic);
        return;
    }

    lastFetchedTopic = topic;
    chrome.storage.sync.set({ 'activeTopic': topic }, async function () {
        chrome.storage.sync.get(['topics'], async function (data) {
            const topics = data.topics || [];
            updateTopicChipsNav(topics, topic);
            if (!topic) {
                clearTopicContent();
            } else {
                let videos = videoCache[topic];
                
                // If not in memory cache, try to load from storage
                if (!videos || videos.length === 0) {
                    videos = await loadVideoCacheFromStorage(topic);
                    if (!videos) {
                        // If not in storage, fetch from API
                        videos = await fetchVideos(topic);
                    }
                }
                
                renderVideoGrid(videos || [], topic);
            }
        });
    });
}

// Save display settings
function saveDisplaySettings() {
    if (!chrome.storage || !chrome.storage.sync) return;

    const hideShorts = document.getElementById('hide-shorts-toggle')?.checked || false;
    const hideSidebar = document.getElementById('hide-sidebar-toggle')?.checked || false;
    const hideComments = document.getElementById('hide-comments-toggle')?.checked || false;

    const settings = {
        'hideShorts': hideShorts,
        'hideSidebar': hideSidebar,
        'hideComments': hideComments
    };

    chrome.storage.sync.set(settings, function () {
        applySettings(settings);
        if (hideShorts) applyShortsHandling();
    });
}

// Apply settings
function applySettings(settings) {
    if (document.body) {
        document.body.classList.toggle('youdefine-hide-shorts', settings.hideShorts);
        if (settings.hideShorts) {
            hideYouTubeShorts();
        } else {
            showYouTubeShorts();
        }

        document.body.classList.toggle('youdefine-hide-sidebar', settings.hideSidebar);
        document.body.classList.toggle('youdefine-hide-comments', settings.hideComments);
    }
}

// Hide YouTube Shorts
function hideYouTubeShorts() {
    const shortsContainers = document.querySelectorAll('ytd-rich-section-renderer, ytd-reel-shelf-renderer');
    shortsContainers.forEach(container => {
        if (container.innerText.includes('Shorts')) {
            container.style.display = 'none';
        }
    });

    if (document.body) document.body.classList.add('youdefine-hide-shorts-classes');
}

// Show YouTube Shorts
function showYouTubeShorts() {
    const shortsContainers = document.querySelectorAll('ytd-rich-section-renderer, ytd-reel-shelf-renderer');
    shortsContainers.forEach(container => {
        container.style.display = '';
    });

    if (document.body) document.body.classList.remove('youdefine-hide-shorts-classes');
}

// Save shorts handling
function saveShortsHandling() {
    const shortsBlock = document.getElementById('shorts-block');
    const shortsConvert = document.getElementById('shorts-convert');
    const hideShorts = document.getElementById('hide-shorts-toggle');

    let shortsHandling = 'block';
    if (shortsConvert && shortsConvert.checked) {
        shortsHandling = 'convert';
    }

    chrome.storage.sync.set({ 'shortsHandling': shortsHandling }, function () {
        if (hideShorts && hideShorts.checked) {
            applyShortsHandling();
        }
    });
}

// Apply shorts handling
function applyShortsHandling() {
    chrome.storage.sync.get(['hideShorts', 'shortsHandling'], function (data) {
        if (!data.hideShorts) return;

        const shortsHandling = data.shortsHandling || 'block';
        processYouTubeShorts(shortsHandling);
        if (isShortsUrl(window.location.href)) {
            handleShortsUrl(shortsHandling);
        }
        setupShortsObserver(shortsHandling);
    });
}

// Check if URL is shorts
function isShortsUrl(url) {
    return url.includes('/shorts/');
}

// Convert shorts URL
function convertShortsToVideoUrl(url) {
    return url.replace('/shorts/', '/watch?v=');
}

// Handle shorts URL
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

// Process YouTube shorts
function processYouTubeShorts(shortsHandling) {
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

    if (document.body) document.body.classList.add('youdefine-hide-shorts-nav');

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
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            const isShortsSection =
                (element.querySelector('a[href^="/shorts"]') !== null) ||
                (element.textContent && element.textContent.includes('Shorts')) ||
                element.hasAttribute('is-shorts') ||
                (element.tagName && element.tagName.toUpperCase() === 'YTD-SHORTS');

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
                    });
                }
            }
        });
    });
}

// Setup shorts observer
function setupShortsObserver(shortsHandling) {
    const observer = new MutationObserver((mutations) => {
        let shouldProcess = false;

        mutations.forEach(mutation => {
            if (mutation.type === 'childList' && mutation.addedNodes.length) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('yt-simple-endpoint')) {
                        shouldProcess = true;
                        break;
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

// Save videos to Chrome storage
function saveVideoCacheToStorage(topic, videos) {
    if (!chrome.storage || !chrome.storage.local) return;
    
    // Create a storage object with the topic as key
    const storageObj = {};
    storageObj[`videoCache_${topic}`] = videos;
    
    chrome.storage.local.set(storageObj, () => {
        console.log(`Saved videos for topic "${topic}" to storage`);
    });
}

// Load videos from Chrome storage
function loadVideoCacheFromStorage(topic) {
    return new Promise((resolve) => {
        if (!chrome.storage || !chrome.storage.local) {
            resolve(null);
            return;
        }
        
        chrome.storage.local.get([`videoCache_${topic}`], (result) => {
            const videos = result[`videoCache_${topic}`];
            if (videos && videos.length > 0) {
                console.log(`Loaded videos for topic "${topic}" from storage`);
                videoCache[topic] = videos;
                resolve(videos);
            } else {
                resolve(null);
            }
        });
    });
}

// Fetch video durations for the videos when possible
async function fetchVideoDurations(videos) {
    if (!videos || videos.length === 0) return videos;
    
    const videoIds = videos.map(video => video.videoId || (video.id && video.id.videoId)).filter(id => !!id);
    if (videoIds.length === 0) return videos;
    
    const batchSize = 50; // Maximum allowed by YouTube API
    const batches = [];
    
    // Split into batches of 50 videoIds
    for (let i = 0; i < videoIds.length; i += batchSize) {
        batches.push(videoIds.slice(i, i + batchSize));
    }
    
    try {
        const promises = batches.map(batch => {
            const idsString = batch.join(',');
            const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${idsString}&key=${API_KEY}`;
            return fetch(url).then(response => response.json());
        });
        
        const results = await Promise.all(promises);
        const durationMap = {};
        
        // Process all batches
        results.forEach(result => {
            if (result.items && result.items.length > 0) {
                result.items.forEach(item => {
                    const videoId = item.id;
                    const duration = item.contentDetails ? item.contentDetails.duration : null;
                    if (duration) {
                        durationMap[videoId] = formatDuration(duration);
                    }
                });
            }
        });
        
        // Update durations in the original videos array
        return videos.map(video => {
            const videoId = video.videoId || (video.id && video.id.videoId);
            if (videoId && durationMap[videoId]) {
                video.duration = durationMap[videoId];
            }
            return video;
        });
    } catch (error) {
        console.error('Error fetching video durations:', error);
        return videos; // Return original videos if there's an error
    }
}

// Format ISO 8601 duration to human readable format
function formatDuration(isoDuration) {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 'N/A';
    
    const hours = match[1] ? parseInt(match[1]) : 0;
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const seconds = match[3] ? parseInt(match[3]) : 0;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Clear topic content
function clearTopicContent() {
    if (contentContainer) {
        contentContainer.innerHTML = ''; // No message needed as we have the "Try searching..." message
        lastRenderedTopic = null;
    }
}

// Main function
async function handleYouTubePage() {
    const currentHomePageState = checkIfHomePage();
    isHomePage = currentHomePageState;
    lastHomePageState = currentHomePageState;

    if (isHomePage) {
        injectYouDefineButton();
        injectHomePageElements();
        loadStoredSettings();
    } else {
        injectYouDefineButton();
        loadStoredSettings();
    }

    if (chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['hideShorts', 'hideSidebar', 'hideComments', 'activeTopic'], async function (settings) {
            if (chrome.runtime.lastError) return;

            applySettings(settings || {});
            if (settings.activeTopic && isHomePage) {
                const topic = settings.activeTopic;
                
                if (videoCache[topic]) {
                    renderVideoGrid(videoCache[topic], topic);
                    lastFetchedTopic = topic;
                } else {
                    // Try to load from storage first
                    const storedVideos = await loadVideoCacheFromStorage(topic);
                    if (storedVideos && storedVideos.length > 0) {
                        renderVideoGrid(storedVideos, topic);
                        lastFetchedTopic = topic;
                    } else if (topic !== lastFetchedTopic) {
                        setActiveTopic(topic);
                    }
                }
            } else if (isHomePage && !settings.activeTopic) {
                clearTopicContent();
            }
        });
    }
}

const debouncedHandleYouTubePage = debounce(handleYouTubePage, 300);

// Setup observer
function setupObserver() {
    const observer = new MutationObserver((mutations) => {
        let significantChange = false;
        for (const mutation of mutations) {
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

    setupYouTubeLogoClickDetection();
}

// Setup logo click detection
function setupYouTubeLogoClickDetection() {
    const logoInterval = setInterval(() => {
        const ytLogo = document.querySelector('ytd-masthead a#logo');
        if (ytLogo) {
            ytLogo.addEventListener('click', () => {
                youtubeLogoClicked = true;
                handleYouTubePage();
            });
            clearInterval(logoInterval);
        }
    }, 500);
}

// Preload all video caches from storage
async function preloadVideoCaches() {
    if (!chrome.storage || !chrome.storage.local) return;
    
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (allItems) => {
            const videoCachePrefix = 'videoCache_';
            
            for (const key in allItems) {
                if (key.startsWith(videoCachePrefix)) {
                    const topic = key.substring(videoCachePrefix.length);
                    const videos = allItems[key];
                    
                    if (videos && videos.length > 0) {
                        videoCache[topic] = videos;
                        console.log(`Preloaded videos for topic "${topic}" from storage (${videos.length} videos)`);
                    }
                }
            }
            
            resolve();
        });
    });
}

// Initialize the extension
async function initializeExtension() {
    // Preload all cached videos from storage
    await preloadVideoCaches();
    
    // Ensure all elements and listeners are set up
    handleYouTubePage();
    setupObserver();

    // Reattach listeners for runtime messages
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'updateSettings') {
            handleYouTubePage();
            loadStoredSettings();
            sendResponse({ status: "Settings received by content script" });
        }
        return true;
    });

    // Add navigation event listeners
    window.addEventListener('yt-navigate-start', () => {
        // Save the current state if we're navigating away from the homepage
        if (isHomePage && lastKnownActiveTopic && videoCache[lastKnownActiveTopic]) {
            saveVideoCacheToStorage(lastKnownActiveTopic, videoCache[lastKnownActiveTopic]);
        }
    });
    
    window.addEventListener('yt-navigate-finish', () => {
        window.requestAnimationFrame(() => {
            debouncedHandleYouTubePage();
        });
    });
    
    // Handle page reload
    window.addEventListener('beforeunload', () => {
        // Save the current state on page refresh
        if (isHomePage && lastKnownActiveTopic && videoCache[lastKnownActiveTopic]) {
            saveVideoCacheToStorage(lastKnownActiveTopic, videoCache[lastKnownActiveTopic]);
        }
    });
}

// Initial setup
if (document.documentElement) {
    initializeExtension();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
    window.addEventListener('load', initializeExtension);
} else {
    initializeExtension();
}