/**
 * ManaGallery — Modern Social Media Client Engine
 * Features: SPA Navigation, Supabase Backend Integration, Anonymous Auth,
 * Media Uploads, Live Interactivity, Infinite Feeds, Toast Notifications.
 */

// Global Application Configuration & State
const CONFIG = {
    // Replace with your actual Supabase Project Credentials
    SUPABASE_URL: "https://your-supabase-project.supabase.co",
    SUPABASE_ANON_KEY: "your-anon-key-here",
    STORAGE_BUCKET: "posts",
    POSTS_PER_PAGE: 5
};

const STATE = {
    supabase: null,
    currentUser: null, // Local user session profile
    currentPage: 'home',
    posts: [],
    pageOffset: 0,
    hasMorePosts: true,
    isLoadingPosts: false,
    selectedPostForComments: null,
    selectedFile: null
};

// Initialize App Setup on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
    initSupabaseClient();
    initLocalSession();
    setupNavigationRouting();
    setupEventListeners();
    
    // Check user auth state
    if (!STATE.currentUser) {
        showAuthModal(true);
    } else {
        updateUserUIHeader();
        await loadInitialAppData();
    }

    hideAppLoader();
});

/* ==========================================================================
   1. SUPABASE CLIENT & AUTH SYSTEM
   ========================================================================== */

function initSupabaseClient() {
    if (window.supabase) {
        STATE.supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    } else {
        console.warn("Supabase SDK not found. Running in local fallback state.");
    }
}

function initLocalSession() {
    const savedUser = localStorage.getItem('mana_user_session');
    if (savedUser) {
        try {
            STATE.currentUser = JSON.parse(savedUser);
        } catch (e) {
            STATE.currentUser = null;
        }
    }
}

function saveLocalSession(profile) {
    STATE.currentUser = profile;
    localStorage.setItem('mana_user_session', JSON.stringify(profile));
    updateUserUIHeader();
}

async function handleAnonymousLogin(displayName) {
    const handle = '@' + displayName.toLowerCase().replace(/\s+/g, '') + '_' + Math.floor(1000 + Math.random() * 9000);
    const defaultAvatar = `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80`;

    const newProfile = {
        id: crypto.randomUUID(),
        display_name: displayName,
        handle: handle,
        avatar_url: defaultAvatar,
        bio: 'Creating moments on ManaGallery 🚀',
        created_at: new Date().toISOString()
    };

    // Attempt to persist profile to Supabase if configured
    if (STATE.supabase) {
        try {
            const { data, error } = await STATE.supabase
                .from('profiles')
                .insert([newProfile])
                .select()
                .single();
            if (!error && data) {
                saveLocalSession(data);
                return;
            }
        } catch (e) {
            console.error("Supabase Profile Sync Error:", e);
        }
    }

    // Fallback to local session save
    saveLocalSession(newProfile);
    showToast("Welcome to ManaGallery, " + displayName + "!", "success");
}

/* ==========================================================================
   2. ROUTING & UI NAVIGATION
   ========================================================================== */

function setupNavigationRouting() {
    const handleRoute = () => {
        const hash = window.location.hash.replace('#', '') || 'home';
        navigateToPage(hash);
    };

    window.addEventListener('hashchange', handleRoute);
    if (window.location.hash) handleRoute();
}

function navigateToPage(pageId) {
    const pages = document.querySelectorAll('.page-view');
    const navItems = document.querySelectorAll('.nav-item');

    pages.forEach(p => p.classList.remove('active'));
    navItems.forEach(n => n.classList.remove('active'));

    const targetPage = document.getElementById(`page-${pageId}`) || document.getElementById('page-home');
    targetPage.classList.add('active');

    // Highlight active nav links
    document.querySelectorAll(`.nav-item[data-page="${pageId}"]`).forEach(el => el.classList.add('active'));

    STATE.currentPage = pageId;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Lazy load specific page content
    if (pageId === 'profile') loadUserProfilePage();
    if (pageId === 'search') loadSearchExplorePage();
}

function updateUserUIHeader() {
    if (!STATE.currentUser) return;
    
    const displayNameEls = [document.getElementById('sidebar-display-name'), document.getElementById('profile-display-name')];
    const handleEls = [document.getElementById('sidebar-handle'), document.getElementById('profile-handle')];
    const avatarEls = [document.getElementById('sidebar-avatar'), document.getElementById('profile-avatar-img'), document.getElementById('settings-avatar-preview'), document.getElementById('story-self-avatar')];

    displayNameEls.forEach(el => { if (el) el.textContent = STATE.currentUser.display_name; });
    handleEls.forEach(el => { if (el) el.textContent = STATE.currentUser.handle; });
    avatarEls.forEach(el => { 
        if (el) {
            el.src = STATE.currentUser.avatar_url; 
            el.style.display = 'block';
        }
    });

    const bioEl = document.getElementById('profile-bio');
    if (bioEl && STATE.currentUser.bio) bioEl.textContent = STATE.currentUser.bio;
}

/* ==========================================================================
   3. FEED & POST CONTROLLERS
   ========================================================================== */

async function loadInitialAppData() {
    await fetchHomeFeedPosts(true);
}

async function fetchHomeFeedPosts(reset = false) {
    if (STATE.isLoadingPosts) return;
    STATE.isLoadingPosts = true;

    if (reset) {
        STATE.pageOffset = 0;
        STATE.posts = [];
    }

    const feedContainer = document.getElementById('feed-container');

    // Attempt fetching posts from Supabase Backend
    if (STATE.supabase) {
        try {
            const { data, error } = await STATE.supabase
                .from('posts')
                .select(`
                    *,
                    profiles:user_id (id, display_name, handle, avatar_url),
                    likes (user_id),
                    comments (id)
                `)
                .order('created_at', { ascending: false })
                .range(STATE.pageOffset, STATE.pageOffset + CONFIG.POSTS_PER_PAGE - 1);

            if (!error && data && data.length > 0) {
                STATE.posts = reset ? data : [...STATE.posts, ...data];
                STATE.pageOffset += data.length;
                renderFeedPosts(STATE.posts);
                STATE.isLoadingPosts = false;
                return;
            }
        } catch (e) {
            console.warn("Using sample mock feed due to network/db setup.");
        }
    }

    // Fallback Mock Data Feed for Instant Preview
    const mockPosts = getMockFeedData();
    STATE.posts = mockPosts;
    renderFeedPosts(mockPosts);
    STATE.isLoadingPosts = false;
}

function renderFeedPosts(posts) {
    const feedContainer = document.getElementById('feed-container');
    if (!feedContainer) return;

    if (posts.length === 0) {
        feedContainer.innerHTML = `
            <div class="glass-card" style="padding: 40px; text-align: center;">
                <h3>No posts yet</h3>
                <p style="color: var(--text-secondary); margin-top: 8px;">Be the first creator to share a photo!</p>
            </div>`;
        return;
    }

    feedContainer.innerHTML = posts.map(post => createPostCardHTML(post)).join('');
}

function createPostCardHTML(post) {
    const isLiked = post.likes ? post.likes.some(l => l.user_id === STATE.currentUser?.id) : false;
    const likesCount = post.likes ? post.likes.length : (post.likes_count || 0);
    const commentsCount = post.comments ? post.comments.length : (post.comments_count || 0);

    return `
        <article class="post-card glass-card animate-pop" data-post-id="${post.id}">
            <div class="post-header">
                <div class="post-user-info">
                    <div class="avatar avatar-md">
                        <img src="${post.profiles?.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80'}" alt="Avatar">
                    </div>
                    <div>
                        <div class="post-username">${post.profiles?.display_name || 'Creator'}</div>
                        <div class="post-time">${formatTimeAgo(post.created_at)}</div>
                    </div>
                </div>
                ${post.user_id === STATE.currentUser?.id ? `
                    <button class="icon-btn-sm delete-post-btn" onclick="deletePost('${post.id}')">
                        <span class="material-icons-round">delete_outline</span>
                    </button>
                ` : ''}
            </div>

            <div class="post-media-wrap" ondblclick="triggerDoubleTapLike('${post.id}')">
                <img src="${post.image_url}" alt="Post Media" loading="lazy">
                <span class="material-icons-round like-overlay-icon" id="like-overlay-${post.id}">favorite</span>
            </div>

            <div class="post-actions">
                <div class="action-left">
                    <button class="action-btn ${isLiked ? 'liked' : ''}" onclick="toggleLikePost('${post.id}')" id="like-btn-${post.id}">
                        <span class="material-icons-round">${isLiked ? 'favorite' : 'favorite_border'}</span>
                    </button>
                    <button class="action-btn" onclick="openCommentsModal('${post.id}')">
                        <span class="material-icons-round">chat_bubble_outline</span>
                    </button>
                    <button class="action-btn" onclick="sharePost('${post.id}')">
                        <span class="material-icons-round">send</span>
                    </button>
                </div>
                <button class="action-btn" onclick="toggleSavePost('${post.id}')">
                    <span class="material-icons-round">bookmark_border</span>
                </button>
            </div>

            <div class="post-body">
                <div class="likes-count"><span id="likes-count-${post.id}">${likesCount}</span> likes</div>
                <div class="caption-text">
                    <strong>${post.profiles?.display_name || 'Creator'}</strong> ${parseHashtags(post.caption || '')}
                </div>
                <div class="comments-link" onclick="openCommentsModal('${post.id}')">
                    View all ${commentsCount} comments
                </div>
            </div>
        </article>
    `;
}

/* ==========================================================================
   4. INTERACTIVITY: LIKES, COMMENTS & CREATION
   ========================================================================== */

async function toggleLikePost(postId) {
    const likeBtn = document.getElementById(`like-btn-${postId}`);
    const likesCountEl = document.getElementById(`likes-count-${postId}`);
    if (!likeBtn || !likesCountEl) return;

    const isCurrentlyLiked = likeBtn.classList.contains('liked');
    let currentCount = parseInt(likesCountEl.textContent, 10) || 0;

    // Optimistic UI Update
    if (isCurrentlyLiked) {
        likeBtn.classList.remove('liked');
        likeBtn.innerHTML = '<span class="material-icons-round">favorite_border</span>';
        likesCountEl.textContent = Math.max(0, currentCount - 1);
    } else {
        likeBtn.classList.add('liked');
        likeBtn.innerHTML = '<span class="material-icons-round">favorite</span>';
        likesCountEl.textContent = currentCount + 1;
    }

    // Persist to Supabase
    if (STATE.supabase && STATE.currentUser) {
        try {
            if (isCurrentlyLiked) {
                await STATE.supabase.from('likes').delete().match({ post_id: postId, user_id: STATE.currentUser.id });
            } else {
                await STATE.supabase.from('likes').insert([{ post_id: postId, user_id: STATE.currentUser.id }]);
            }
        } catch (e) {
            console.error("Like toggle error:", e);
        }
    }
}

function triggerDoubleTapLike(postId) {
    const overlay = document.getElementById(`like-overlay-${postId}`);
    if (overlay) {
        overlay.classList.add('active');
        setTimeout(() => overlay.classList.remove('active'), 800);
    }
    toggleLikePost(postId);
}

async function handlePostUpload(e) {
    e.preventDefault();
    const caption = document.getElementById('upload-caption').value.trim();
    const submitBtn = document.getElementById('upload-submit-btn');

    if (!STATE.selectedFile) {
        showToast("Please select an image to upload.", "error");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<div class="spinner"></div> <span>Uploading...</span>`;

    try {
        let imageUrl = URL.createObjectURL(STATE.selectedFile);

        // Upload to Supabase Storage if available
        if (STATE.supabase) {
            const fileName = `${Date.now()}_${STATE.selectedFile.name}`;
            const { data: uploadData, error: uploadErr } = await STATE.supabase.storage
                .from(CONFIG.STORAGE_BUCKET)
                .upload(fileName, STATE.selectedFile);

            if (!uploadErr && uploadData) {
                const { data: publicUrlData } = STATE.supabase.storage
                    .from(CONFIG.STORAGE_BUCKET)
                    .getPublicUrl(fileName);
                imageUrl = publicUrlData.publicUrl;
            }
        }

        const newPost = {
            id: crypto.randomUUID(),
            user_id: STATE.currentUser.id,
            image_url: imageUrl,
            caption: caption,
            created_at: new Date().toISOString(),
            profiles: STATE.currentUser,
            likes: [],
            comments: []
        };

        if (STATE.supabase) {
            await STATE.supabase.from('posts').insert([{
                id: newPost.id,
                user_id: newPost.user_id,
                image_url: newPost.image_url,
                caption: newPost.caption
            }]);
        }

        STATE.posts.unshift(newPost);
        renderFeedPosts(STATE.posts);
        
        // Reset Upload Form
        document.getElementById('upload-form').reset();
        clearImagePreview();
        showToast("Post published successfully!", "success");
        window.location.hash = '#home';

    } catch (e) {
        showToast("Failed to upload post. Try again.", "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span class="material-icons-round">send</span><span>Publish Post</span>`;
    }
}

/* ==========================================================================
   5. COMMENTS MODAL SYSTEM
   ========================================================================== */

function openCommentsModal(postId) {
    STATE.selectedPostForComments = postId;
    const modal = document.getElementById('comments-modal');
    const commentsList = document.getElementById('modal-comments-list');

    const post = STATE.posts.find(p => p.id === postId);
    commentsList.innerHTML = '';

    if (post && post.comments && post.comments.length > 0) {
        commentsList.innerHTML = post.comments.map(c => `
            <div class="comment-item">
                <div class="avatar avatar-sm"><img src="${c.user_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80'}"></div>
                <div class="comment-bubble">
                    <span class="comment-user">${c.user_name || 'User'}</span>
                    <span>${c.content}</span>
                </div>
            </div>
        `).join('');
    } else {
        commentsList.innerHTML = `<p style="color:var(--text-tertiary); text-align:center; padding: 20px;">No comments yet. Start the conversation!</p>`;
    }

    modal.classList.add('active');
}

/* ==========================================================================
   6. UTILITY FUNCTIONS & EVENT LISTENERS
   ========================================================================== */

function setupEventListeners() {
    // Auth Gateway
    document.getElementById('auth-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-username').value.trim();
        if (username) {
            handleAnonymousLogin(username);
            showAuthModal(false);
        }
    });

    // Upload Dropzone Handlers
    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('file-input');

    if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
    }

    document.getElementById('upload-form')?.addEventListener('submit', handlePostUpload);
    document.getElementById('remove-preview-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        clearImagePreview();
    });

    // Comment Modal Close
    document.getElementById('close-comments-modal')?.addEventListener('click', () => {
        document.getElementById('comments-modal').classList.remove('active');
    });

    // SQL Schema Modal Trigger
    document.getElementById('show-sql-modal-btn')?.addEventListener('click', () => {
        document.getElementById('sql-modal').classList.add('active');
    });
    document.getElementById('close-sql-modal')?.addEventListener('click', () => {
        document.getElementById('sql-modal').classList.remove('active');
    });
}

function handleFileSelect(file) {
    if (!file || !file.type.startsWith('image/')) {
        showToast("Please select a valid image file.", "error");
        return;
    }
    STATE.selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('upload-preview-img').src = e.target.result;
        document.getElementById('dropzone-prompt').style.display = 'none';
        document.getElementById('preview-wrap').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function clearImagePreview() {
    STATE.selectedFile = null;
    document.getElementById('file-input').value = '';
    document.getElementById('upload-preview-img').src = '';
    document.getElementById('dropzone-prompt').style.display = 'block';
    document.getElementById('preview-wrap').style.display = 'none';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="material-icons-round toast-icon">${type === 'success' ? 'check_circle' : 'info'}</span>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function showAuthModal(show) {
    const modal = document.getElementById('auth-modal');
    if (show) modal.classList.add('active');
    else modal.classList.remove('active');
}

function hideAppLoader() {
    const loader = document.getElementById('app-loader');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 400);
    }
}

function parseHashtags(text) {
    return text.replace(/#(\w+)/g, '<span class="hashtag">#$1</span>');
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function getMockFeedData() {
    return [
        {
            id: 'mock-1',
            user_id: 'user-a',
            image_url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80',
            caption: 'Serenity found at the coast. #nature #minimal #vibes',
            created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
            profiles: { display_name: 'Elena Rostova', handle: '@elena_r', avatar_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&q=80' },
            likes: [1, 2, 3],
            comments: [{ user_name: 'Alex', content: 'Stunning colors!' }]
        },
        {
            id: 'mock-2',
            user_id: 'user-b',
            image_url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1000&q=80',
            caption: 'Architectural precision and geometry. #design #apple #architecture',
            created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
            profiles: { display_name: 'Marcus Vance', handle: '@mvance', avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80' },
            likes: [1, 2, 3, 4, 5],
            comments: []
        }
    ];
}
