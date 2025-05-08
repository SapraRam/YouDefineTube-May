document.addEventListener('DOMContentLoaded', function() {
    // Load saved topics
    loadTopics();
    
    // Load display settings
    loadDisplaySettings();
    
    // Add event listeners
    document.getElementById('addTopic').addEventListener('click', addTopic);
    document.getElementById('topic').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addTopic();
        }
    });
    
    // Toggle options event listeners
    document.getElementById('hideShorts').addEventListener('change', saveDisplaySettings);
    document.getElementById('hideSidebar').addEventListener('change', saveDisplaySettings);
    document.getElementById('hideComments').addEventListener('change', saveDisplaySettings);
});

// Load saved topics from storage
function loadTopics() {
    chrome.storage.sync.get(['topics', 'activeTopic'], function(data) {
        const topics = data.topics || [];
        const activeTopic = data.activeTopic || '';
        
        const topicsContainer = document.getElementById('topicsContainer');
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
    });
}

// Add a new topic
function addTopic() {
    const topicInput = document.getElementById('topic');
    const topic = topicInput.value.trim();
    const inputLabel = document.querySelector('label[for="topic"]');
    
    // Reset any previous error state
    topicInput.style.borderColor = '';
    if (inputLabel) inputLabel.style.color = '';
    
    if (!topic) {
        // Show error state
        topicInput.style.borderColor = '#ff0000';
        if (inputLabel) inputLabel.style.color = '#ff0000';
        
        // Add shake animation
        topicInput.classList.add('shake-animation');
        setTimeout(() => {
            topicInput.classList.remove('shake-animation');
        }, 500);
        
        return; // Exit function
    }
    
    if (topic) {
        chrome.storage.sync.get(['topics'], function(data) {
            const topics = data.topics || [];
            
            // Check if topic already exists
            if (!topics.includes(topic)) {
                topics.push(topic);
                chrome.storage.sync.set({ 'topics': topics }, function() {
                    topicInput.value = '';
                    loadTopics();
                    
                    // If this is the first topic, make it active
                    if (topics.length === 1) {
                        setActiveTopic(topic);
                    }
                });
            } else {
                topicInput.value = '';
                // Highlight the existing topic
                setActiveTopic(topic);
            }
        });
    }
}

// Remove a topic
function removeTopic(topicToRemove) {
    chrome.storage.sync.get(['topics', 'activeTopic'], function(data) {
        const topics = data.topics || [];
        const activeTopic = data.activeTopic || '';
        
        const updatedTopics = topics.filter(topic => topic !== topicToRemove);
        
        // Update storage
        chrome.storage.sync.set({ 'topics': updatedTopics }, function() {
            // If removing the active topic, clear the active topic
            if (topicToRemove === activeTopic) {
                chrome.storage.sync.set({ 'activeTopic': '' });
            }
            
            loadTopics();
            
            // Update content script
            sendMessageToContentScript();
        });
    });
}

// Set active topic
function setActiveTopic(topic) {
    chrome.storage.sync.set({ 'activeTopic': topic }, function() {
        loadTopics();
        sendMessageToContentScript();
    });
}

// Load display settings
function loadDisplaySettings() {
    chrome.storage.sync.get(['hideShorts', 'hideSidebar', 'hideComments'], function(data) {
        document.getElementById('hideShorts').checked = data.hideShorts || false;
        document.getElementById('hideSidebar').checked = data.hideSidebar || false;
        document.getElementById('hideComments').checked = data.hideComments || false;
    });
}

// Save display settings
function saveDisplaySettings() {
    const hideShorts = document.getElementById('hideShorts').checked;
    const hideSidebar = document.getElementById('hideSidebar').checked;
    const hideComments = document.getElementById('hideComments').checked;
    
    chrome.storage.sync.set({
        'hideShorts': hideShorts,
        'hideSidebar': hideSidebar,
        'hideComments': hideComments
    }, function() {
        sendMessageToContentScript();
    });
}

// Send message to content script to update settings
function sendMessageToContentScript() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs[0] && tabs[0].url.includes('youtube.com')) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'updateSettings' });
        }
    });
}