// API Base URL
const API_BASE_URL = 'http://localhost:3749/api/v1';

// Token management
let isRefreshing = false;
let failedQueue = [];

// Process queue after token refresh
function processQueue(error, token = null) {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve(token);
    }
  });
  failedQueue = [];
}

// Get token from storage
function getToken() {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
}

// Set token in storage
function setToken(token) {
  // Simpan di tempat yang sama dengan token sebelumnya
  if (localStorage.getItem('token')) {
    localStorage.setItem('token', token);
  } else {
    sessionStorage.setItem('token', token);
  }
}

// Clear authentication data
function clearAuthData() {
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
  localStorage.removeItem('role');
  // Tidak perlu clear refresh_token karena itu HttpOnly cookie
}

// Redirect to login page
function redirectToLogin() {
  clearAuthData();
  window.location.href = 'login.html';
}

// Refresh token function
async function refreshToken() {
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      failedQueue.push({ resolve, reject });
    });
  }

  isRefreshing = true;

  try {
    console.log('Attempting to refresh token...');
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // Penting untuk mengirim cookies
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log('Refresh token response status:', response.status);

    if (!response.ok) {
      // Jika status 401, berarti refresh token juga expired/invalid
      if (response.status === 401) {
        console.log('Refresh token expired or invalid');
        throw new Error('REFRESH_TOKEN_EXPIRED');
      }
      throw new Error(`Refresh failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Refresh token response:', data);

    if (!data.access_token) {
      throw new Error('No access token in response');
    }

    // Store the new access token
    setToken(data.access_token);

    // Process all queued requests
    processQueue(null, data.access_token);

    console.log('Token refreshed successfully');
    return data.access_token;
  } catch (error) {
    console.error('Token refresh failed:', error);

    // Jika refresh token expired, redirect ke login
    if (error.message === 'REFRESH_TOKEN_EXPIRED') {
      console.log('Redirecting to login due to expired refresh token');
      redirectToLogin();
    }

    processQueue(error, null);
    throw error;
  } finally {
    isRefreshing = false;
  }
}

// Enhanced fetch with automatic token refresh
async function authFetch(url, options = {}) {
  let token = getToken();

  if (!token) {
    console.log('No token found, redirecting to login');
    redirectToLogin();
    return;
  }

  // Set default headers
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  try {
    // First attempt
    let response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    console.log(`API ${url} response status:`, response.status);

    // If token is expired, try to refresh
    if (response.status === 401) {
      console.log('Access token expired, attempting refresh...');
      try {
        const newToken = await refreshToken();
        console.log('New token obtained:', newToken);

        // Retry request with new token
        headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(`${API_BASE_URL}${url}`, {
          ...options,
          headers,
          credentials: 'include',
        });

        return response;
      } catch (refreshError) {
        console.error('Refresh token failed:', refreshError);
        redirectToLogin();
        throw refreshError;
      }
    }

    return response;
  } catch (error) {
    console.error(`Auth fetch error for ${url}:`, error);
    throw error;
  }
}

// Universal API request handler
async function apiRequest(endpoint, options = {}) {
  try {
    const response = await authFetch(endpoint, options);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API Request failed for ${endpoint}:`, error);
    throw error;
  }
}

// Check if user is authenticated
async function checkAuthentication() {
  const token = getToken();

  if (!token) {
    console.log('No authentication token found, redirecting to login');
    redirectToLogin();
    return false;
  }

  try {
    // Cek token expiration
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp * 1000;
    const now = Date.now();
    console.log('Token expires at:', new Date(exp));
    console.log('Current time:', new Date(now));
    console.log('Time until expiration:', (exp - now) / 1000 / 60, 'minutes');

    // Verify token and get user role
    const data = await apiRequest('/profile/role');
    const role = data.role;
    localStorage.setItem('role', role);
    console.log('User role:', role);

    // If user is not admin, redirect to user dashboard
    if (role !== 'admin') {
      console.log('User is not admin, redirecting to user dashboard');
      window.location.href = 'dashboard.html';
      return false;
    }

    // If user is admin, continue with normal flow
    console.log('Admin user detected, continuing to admin dashboard');

    return true;
  } catch (error) {
    console.error('Error checking authentication:', error);
    redirectToLogin();
    return false;
  }
}

// Auto refresh token before expiration (optional)
function setupTokenAutoRefresh() {
  // Check token expiration every minute
  setInterval(async () => {
    const token = getToken();
    if (!token) return;

    try {
      // Decode token to check expiration
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp = payload.exp * 1000;
      const now = Date.now();
      const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

      // Refresh if token expires in less than buffer time
      if (exp - now < bufferTime) {
        console.log('Auto-refreshing token before expiration...');
        await refreshToken();
        console.log('Token auto-refreshed successfully');
      }
    } catch (error) {
      console.error('Error in token auto-refresh:', error);
    }
  }, 60 * 1000);
}

// DOM Elements
const sidebarLinks = document.querySelectorAll('.sidebar-link');
const contentSections = document.querySelectorAll('.content-section');
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');
const body = document.body;
const profileMenu = document.getElementById('profileMenu');
const profileToggle = document.querySelector('.profile-toggle');
const currentDateElement = document.getElementById('current-date');
const overlay = document.getElementById('overlay');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');

// Modal Elements
const modals = document.querySelectorAll('.modal');
const closeButtons = document.querySelectorAll('.close');
const addNeedBtn = document.getElementById('add-need-btn');
const addPageBtn = document.getElementById('add-page-btn');
const addStatusBtn = document.getElementById('add-status-btn');
const addColorBtn = document.getElementById('add-color-btn');

// Cancel Buttons
const cancelNeedBtn = document.getElementById('cancel-need-btn');
const cancelPageBtn = document.getElementById('cancel-page-btn');
const cancelStatusBtn = document.getElementById('cancel-status-btn');
const cancelColorBtn = document.getElementById('cancel-color-btn');
const cancelOrderDetailBtn = document.getElementById('cancel-order-detail-btn');
const cancelEditNeedBtn = document.getElementById('cancel-edit-need-btn');
const cancelEditPageBtn = document.getElementById('cancel-edit-page-btn');
const cancelEditStatusBtn = document.getElementById('cancel-edit-status-btn');
const cancelEditColorBtn = document.getElementById('cancel-edit-color-btn');

// Submit Buttons
const submitNeedBtn = document.getElementById('submit-need-btn');
const submitPageBtn = document.getElementById('submit-page-btn');
const submitStatusBtn = document.getElementById('submit-status-btn');
const submitColorBtn = document.getElementById('submit-color-btn');
const updateStatusBtn = document.getElementById('update-status-btn');
const submitEditNeedBtn = document.getElementById('submit-edit-need-btn');
const submitEditPageBtn = document.getElementById('submit-edit-page-btn');
const submitEditStatusBtn = document.getElementById('submit-edit-status-btn');
const submitEditColorBtn = document.getElementById('submit-edit-color-btn');

// Toast Elements
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Global variables
let currentOrders = [];
let statusList = [];
let currentOrderId = null;

// Set current date
const now = new Date();
currentDateElement.textContent = now.toLocaleDateString('id-ID', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

// Event Listeners
document.addEventListener('DOMContentLoaded', function () {
  // Check authentication first
  checkAuthentication().then((isAuthenticated) => {
    if (!isAuthenticated) return;

    // Load initial data
    loadDashboardData();
    loadNeeds();
    loadPages();
    loadStatus();
    loadColors();
    loadOrders();
    loadProfileData(); // Load profile data

    // Setup event listeners
    setupEventListeners();

    // Initialize auto-refresh after successful authentication
    if (getToken()) {
      setupTokenAutoRefresh();
    }
  });
});

function setupEventListeners() {
  // Sidebar navigation
  sidebarLinks.forEach((link) => {
    link.addEventListener('click', function (e) {
      const section = this.getAttribute('data-section');
      const href = this.getAttribute('href');

      // Jika link menuju ke anchor ID di halaman yang sama
      if (href && href.startsWith('#')) {
        e.preventDefault();

        // Update active link
        sidebarLinks.forEach((l) => l.classList.remove('active'));
        this.classList.add('active');

        // Show corresponding section
        contentSections.forEach((s) => s.classList.remove('active'));
        document.getElementById(`${section}-section`).classList.add('active');

        // Scroll ke bagian yang dituju
        const targetElement = document.querySelector(href);
        if (targetElement) {
          window.scrollTo({
            top: targetElement.offsetTop - 100, // Offset untuk header fixed
            behavior: 'smooth',
          });
        }
      } else {
        // Untuk link biasa, biarkan perilaku default
      }

      // Close sidebar on mobile after clicking
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
      }
    });
  });

  // Mobile menu toggle
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');

    if (navMenu.classList.contains('active')) {
      body.style.overflow = 'hidden';
      overlay.classList.add('active');
    } else {
      body.style.overflow = 'auto';
      overlay.classList.remove('active');
    }
  });

  // Sidebar toggle for mobile
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
  });

  // Overlay click to close sidebar and menu
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('active');
    navMenu.classList.remove('active');
    hamburger.classList.remove('active');
    overlay.classList.remove('active');
    body.style.overflow = 'auto';
  });

  // Profile menu toggle
  profileToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    profileMenu.classList.toggle('active');
  });

  // Close profile menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!profileMenu.contains(e.target)) {
      profileMenu.classList.remove('active');
    }
  });

  // Logout functionality
  document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await logout();
  });

  // Modal functionality
  addNeedBtn.addEventListener('click', () => openModal('add-need-modal'));
  addPageBtn.addEventListener('click', () => openModal('add-page-modal'));
  addStatusBtn.addEventListener('click', () => openModal('add-status-modal'));
  addColorBtn.addEventListener('click', () => openModal('add-color-modal'));

  closeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      modals.forEach((modal) => (modal.style.display = 'none'));
    });
  });

  cancelNeedBtn.addEventListener('click', () => closeModal('add-need-modal'));
  cancelPageBtn.addEventListener('click', () => closeModal('add-page-modal'));
  cancelStatusBtn.addEventListener('click', () => closeModal('add-status-modal'));
  cancelColorBtn.addEventListener('click', () => closeModal('add-color-modal'));
  cancelOrderDetailBtn.addEventListener('click', () => closeModal('order-detail-modal'));
  cancelEditNeedBtn.addEventListener('click', () => closeModal('edit-need-modal'));
  cancelEditPageBtn.addEventListener('click', () => closeModal('edit-page-modal'));
  cancelEditStatusBtn.addEventListener('click', () => closeModal('edit-status-modal'));
  cancelEditColorBtn.addEventListener('click', () => closeModal('edit-color-modal'));

  // Submit buttons
  submitNeedBtn.addEventListener('click', addNeed);
  submitPageBtn.addEventListener('click', addPage);
  submitStatusBtn.addEventListener('click', addStatus);
  submitColorBtn.addEventListener('click', addColor);
  updateStatusBtn.addEventListener('click', updateOrderStatus);
  submitEditNeedBtn.addEventListener('click', updateNeed);
  submitEditPageBtn.addEventListener('click', updatePage);
  submitEditStatusBtn.addEventListener('click', updateStatus);
  submitEditColorBtn.addEventListener('click', updateColor);

  // Close modal when clicking outside
  window.addEventListener('click', (e) => {
    modals.forEach((modal) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  });
}

// Modal functions
function openModal(modalId) {
  document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
  // Reset form
  const form = document.querySelector(`#${modalId} form`);
  if (form) form.reset();
}

// Toast notification
function showToast(message, type = 'success') {
  toast.className = `toast ${type}`;
  toastMessage.textContent = message;

  const icon = toast.querySelector('i');
  icon.className = type === 'success' ? 'fas fa-check-circle' : type === 'error' ? 'fas fa-exclamation-circle' : 'fas fa-exclamation-triangle';

  toast.style.display = 'flex';

  // Hide after 3 seconds
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

// Load image with authentication
async function loadImageWithToken(imgElement, imagePath) {
  if (!imagePath) {
    imgElement.src = 'https://placehold.co/40x40/977DFF/FFFFFF?text=A';
    return;
  }

  try {
    const response = await authFetch(`/profile/image?path=${encodeURIComponent(imagePath)}`);

    if (response && response.ok) {
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      imgElement.src = objectUrl;

      // Store the object URL to revoke it later
      imgElement.setAttribute('data-object-url', objectUrl);
    } else {
      imgElement.src = 'https://placehold.co/40x40/977DFF/FFFFFF?text=A';
    }
  } catch (error) {
    console.error('Error loading image:', error);
    imgElement.src = 'https://placehold.co/40x40/977DFF/FFFFFF?text=A';
  }
}

// Clean up object URLs when page is unloaded
window.addEventListener('beforeunload', () => {
  document.querySelectorAll('img[data-object-url]').forEach((img) => {
    const objectUrl = img.getAttribute('data-object-url');
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  });
});

// Load profile data
async function loadProfileData() {
  try {
    const profileData = await apiRequest('/profile');

    if (profileData) {
      // Update profile information in navigation
      document.getElementById('profileName').textContent = profileData.username || 'Admin';

      // Update profile image with authentication
      if (profileData.profile_path) {
        await loadImageWithToken(document.getElementById('profileImage'), profileData.profile_path);
      } else {
        document.getElementById('profileImage').src = 'https://placehold.co/40x40/977DFF/FFFFFF?text=A';
      }
    }
  } catch (error) {
    console.error('Error loading profile data:', error);
    showToast('Gagal memuat data profil', 'error');
  }
}

async function downloadReferenceFile(path) {
  try {
    const response = await authFetch(`/orders/reference?path=${encodeURIComponent(path)}`);

    if (response && response.ok) {
      // Membuat blob dari response
      const blob = await response.blob();

      // Membuat URL objek dari blob
      const blobUrl = window.URL.createObjectURL(blob);

      // Membuat elemen anchor untuk download
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = path.split('/').pop() || 'reference-file';
      document.body.appendChild(a);
      a.click();

      // Membersihkan
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);

      showToast('File berhasil didownload');
    } else {
      showToast('Gagal mendownload file', 'error');
    }
  } catch (error) {
    console.error('Error downloading file:', error);
    showToast('Terjadi kesalahan saat mendownload file', 'error');
  }
}

// Load dashboard data
async function loadDashboardData() {
  try {
    // Load recent orders
    const orders = await apiRequest('/orders/get');
    if (orders && orders.length > 0) {
      document.getElementById('orders-count').textContent = orders.length;

      const recentOrders = orders.slice(0, 5);
      const ordersHtml = recentOrders
        .map(
          (order) => `
                        <tr>
                            <td>#${order.id}</td>
                            <td>${order.company_name}</td>
                            <td>${order.need}</td>
                            <td><span class="badge badge-primary">${order.status}</span></td>
                            <td>${new Date().toLocaleDateString('id-ID')}</td>
                            <td class="action-buttons">
                                <button class="btn btn-primary btn-sm view-order-btn" data-id="${order.id}">Detail</button>
                            </td>
                        </tr>
                    `
        )
        .join('');

      document.getElementById('recent-orders').innerHTML = ordersHtml;

      // Add event listeners to view order buttons
      document.querySelectorAll('.view-order-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const orderId = btn.getAttribute('data-id');
          viewOrderDetail(orderId);
        });
      });
    } else {
      document.getElementById('recent-orders').innerHTML = `
                        <tr>
                            <td colspan="6" class="text-center">Tidak ada data orders</td>
                        </tr>
                    `;
    }

    // Load counts for other sections
    const needs = await apiRequest('/needs/list');
    if (needs) document.getElementById('needs-count').textContent = needs.length;

    const pages = await apiRequest('/pages/list');
    if (pages) document.getElementById('pages-count').textContent = pages.length;

    const colors = await apiRequest('/colors/list');
    if (colors) document.getElementById('colors-count').textContent = colors.length;
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    showToast('Gagal memuat data dashboard', 'error');
  }
}

// Load needs
async function loadNeeds() {
  try {
    const needs = await apiRequest('/needs/list');

    if (needs && needs.length > 0) {
      const needsHtml = needs
        .map(
          (need) => `
                        <tr>
                            <td>${need.id}</td>
                            <td>${need.name}</td>
                            <td class="action-buttons">
                                <button class="btn btn-warning btn-sm edit-need-btn" data-id="${need.id}" data-name="${need.name}">Edit</button>
                                <button class="btn btn-danger btn-sm delete-need-btn" data-id="${need.id}">Hapus</button>
                            </td>
                        </tr>
                    `
        )
        .join('');

      document.getElementById('needs-list').innerHTML = needsHtml;

      // Add event listeners to edit and delete buttons
      document.querySelectorAll('.edit-need-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');
          openEditNeedModal(id, name);
        });
      });

      document.querySelectorAll('.delete-need-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          deleteNeed(id);
        });
      });
    } else {
      document.getElementById('needs-list').innerHTML = `
                        <tr>
                            <td colspan="3" class="text-center">Tidak ada data needs</td>
                        </tr>
                    `;
    }
  } catch (error) {
    console.error('Error loading needs:', error);
    showToast('Gagal memuat data needs', 'error');
  }
}

// Load pages
async function loadPages() {
  try {
    const pages = await apiRequest('/pages/list');

    if (pages && pages.length > 0) {
      const pagesHtml = pages
        .map(
          (page) => `
                        <tr>
                            <td>${page.id}</td>
                            <td>${page.name}</td>
                            <td class="action-buttons">
                                <button class="btn btn-warning btn-sm edit-page-btn" data-id="${page.id}" data-name="${page.name}">Edit</button>
                                <button class="btn btn-danger btn-sm delete-page-btn" data-id="${page.id}">Hapus</button>
                            </td>
                        </tr>
                    `
        )
        .join('');

      document.getElementById('pages-list').innerHTML = pagesHtml;

      // Add event listeners to edit and delete buttons
      document.querySelectorAll('.edit-page-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');
          openEditPageModal(id, name);
        });
      });

      document.querySelectorAll('.delete-page-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          deletePage(id);
        });
      });
    } else {
      document.getElementById('pages-list').innerHTML = `
                        <tr>
                            <td colspan="3" class="text-center">Tidak ada data pages</td>
                        </tr>
                    `;
    }
  } catch (error) {
    console.error('Error loading pages:', error);
    showToast('Gagal memuat data pages', 'error');
  }
}

// Load status
async function loadStatus() {
  try {
    const status = await apiRequest('/status/list');
    statusList = status || [];

    if (statusList.length > 0) {
      const statusHtml = statusList
        .map(
          (s) => `
                        <tr>
                            <td>${s.id}</td>
                            <td>${s.name}</td>
                            <td class="action-buttons">
                                <button class="btn btn-warning btn-sm edit-status-btn" data-id="${s.id}" data-name="${s.name}">Edit</button>
                                <button class="btn btn-danger btn-sm delete-status-btn" data-id="${s.id}">Hapus</button>
                            </td>
                        </tr>
                    `
        )
        .join('');

      document.getElementById('status-list').innerHTML = statusHtml;

      // Add event listeners to edit and delete buttons
      document.querySelectorAll('.edit-status-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');
          openEditStatusModal(id, name);
        });
      });

      document.querySelectorAll('.delete-status-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          deleteStatus(id);
        });
      });
    } else {
      document.getElementById('status-list').innerHTML = `
                        <tr>
                            <td colspan="3" class="text-center">Tidak ada data status</td>
                        </tr>
                    `;
    }
  } catch (error) {
    console.error('Error loading status:', error);
    showToast('Gagal memuat data status', 'error');
  }
}

// Load colors
async function loadColors() {
  try {
    const colors = await apiRequest('/colors/list');

    if (colors && colors.length > 0) {
      const colorsHtml = colors
        .map(
          (color) => `
                        <tr>
                            <td>${color.id}</td>
                            <td>${color.name}</td>
                            <td>${color.hex_code}</td>
                            <td><div style="width: 30px; height: 30px; background-color: ${color.hex_code}; border-radius: 4px;"></div></td>
                            <td class="action-buttons">
                                <button class="btn btn-warning btn-sm edit-color-btn" data-id="${color.id}" data-name="${color.name}" data-hex="${color.hex_code}">Edit</button>
                                <button class="btn btn-danger btn-sm delete-color-btn" data-id="${color.id}">Hapus</button>
                            </td>
                        </tr>
                    `
        )
        .join('');

      document.getElementById('colors-list').innerHTML = colorsHtml;

      // Add event listeners to edit and delete buttons
      document.querySelectorAll('.edit-color-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');
          const hex = btn.getAttribute('data-hex');
          openEditColorModal(id, name, hex);
        });
      });

      document.querySelectorAll('.delete-color-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          deleteColor(id);
        });
      });
    } else {
      document.getElementById('colors-list').innerHTML = `
                        <tr>
                            <td colspan="5" class="text-center">Tidak ada data colors</td>
                        </tr>
                    `;
    }
  } catch (error) {
    console.error('Error loading colors:', error);
    showToast('Gagal memuat data colors', 'error');
  }
}

// Load orders
async function loadOrders() {
  try {
    const orders = await apiRequest('/orders/get');
    currentOrders = orders || [];

    if (currentOrders.length > 0) {
      const ordersHtml = currentOrders
        .map(
          (order) => `
                        <tr>
                            <td>#${order.id}</td>
                            <td>${order.company_name}</td>
                            <td>${order.need}</td>
                            <td><span class="badge badge-primary">${order.status}</span></td>
                            <td>${new Date().toLocaleDateString('id-ID')}</td>
                            <td class="action-buttons">
                                <button class="btn btn-primary btn-sm view-order-btn" data-id="${order.id}">Detail</button>
                            </td>
                        </tr>
                    `
        )
        .join('');

      document.getElementById('orders-list').innerHTML = ordersHtml;

      // Add event listeners to view order buttons
      document.querySelectorAll('.view-order-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const orderId = btn.getAttribute('data-id');
          viewOrderDetail(orderId);
        });
      });
    } else {
      document.getElementById('orders-list').innerHTML = `
                        <tr>
                            <td colspan="6"class="text-center">Tidak ada data orders</td>
                        </tr>
                    `;
    }
  } catch (error) {
    console.error('Error loading orders:', error);
    showToast('Gagal memuat data orders', 'error');
  }
}

// View order detail
async function viewOrderDetail(orderId) {
  const order = currentOrders.find((o) => o.id == orderId);
  if (!order) {
    showToast('Order tidak ditemukan', 'error');
    return;
  }

  currentOrderId = orderId;

  // Populate order details
  document.getElementById('detail-order-id').textContent = order.id;
  document.getElementById('detail-company-name').textContent = order.company_name;
  document.getElementById('detail-need').textContent = order.need;
  document.getElementById('detail-notes').textContent = order.notes || '-';
  document.getElementById('detail-reference-link').textContent = order.reference_link || '-';

  const referenceFileContainer = document.getElementById('detail-reference-file');
  if (order.reference_path) {
    // Extract filename from path
    const fileName = order.reference_path.split('/').pop() || 'reference-file';

    // Create download button
    referenceFileContainer.innerHTML = `
            <button class="btn btn-primary btn-sm" onclick="downloadReferenceFile('${order.reference_path}')">
                <i class="fas fa-download"></i> ${fileName}
            </button>
        `;
  } else {
    referenceFileContainer.textContent = '-';
  }

  // Populate pages
  const pagesContainer = document.getElementById('detail-pages');
  if (order.pages && order.pages.length > 0) {
    pagesContainer.innerHTML = order.pages
      .map(
        (page) => `
                    <div>${page.name}</div>
                `
      )
      .join('');
  } else {
    pagesContainer.textContent = '-';
  }

  // Populate colors
  const colorsContainer = document.getElementById('detail-colors');
  if (order.colors && order.colors.length > 0) {
    colorsContainer.innerHTML = order.colors
      .map(
        (color) => `
                    <div class="color-item">
                        <span class="color-preview" style="background-color: ${color.hex_code};"></span>
                        ${color.name} (${color.hex_code})
                    </div>
                `
      )
      .join('');
  } else {
    colorsContainer.textContent = '-';
  }

  // Populate status dropdown
  const statusDropdown = document.getElementById('detail-status');
  if (statusList.length > 0) {
    statusDropdown.innerHTML = statusList
      .map(
        (status) => `
                    <option value="${status.id}" ${order.status === status.name ? 'selected' : ''}>${status.name}</option>
                `
      )
      .join('');
  } else {
    statusDropdown.innerHTML = '<option value="">Tidak ada status tersedia</option>';
  }

  openModal('order-detail-modal');
}

// Update order status
async function updateOrderStatus() {
  const statusId = document.getElementById('detail-status').value;

  if (!statusId) {
    showToast('Pilih status terlebih dahulu', 'error');
    return;
  }

  try {
    const result = await apiRequest('/orders/update', {
      method: 'PUT',
      body: JSON.stringify({
        order_id: parseInt(currentOrderId),
        status_id: parseInt(statusId),
      }),
    });

    if (result) {
      showToast('Status order berhasil diperbarui');
      closeModal('order-detail-modal');
      loadOrders();
      loadDashboardData(); // Refresh dashboard
    }
  } catch (error) {
    console.error('Error updating order status:', error);
    showToast('Gagal memperbarui status order', 'error');
  }
}

// Add need
async function addNeed() {
  const name = document.getElementById('need-name').value.trim();

  if (!name) {
    showToast('Nama kebutuhan tidak boleh kosong', 'error');
    return;
  }

  try {
    const result = await apiRequest('/needs/add', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    if (result) {
      showToast('Kebutuhan berhasil ditambahkan');
      closeModal('add-need-modal');
      loadNeeds();
      loadDashboardData(); // Refresh counts
    }
  } catch (error) {
    console.error('Error adding need:', error);
    showToast('Gagal menambahkan kebutuhan', 'error');
  }
}

// Open edit need modal
function openEditNeedModal(id, name) {
  document.getElementById('edit-need-id').value = id;
  document.getElementById('edit-need-name').value = name;
  openModal('edit-need-modal');
}

// Update need
async function updateNeed() {
  const id = document.getElementById('edit-need-id').value;
  const name = document.getElementById('edit-need-name').value.trim();

  if (!name) {
    showToast('Nama kebutuhan tidak boleh kosong', 'error');
    return;
  }

  try {
    const result = await apiRequest('/needs/update', {
      method: 'PUT',
      body: JSON.stringify({
        need_id: parseInt(id),
        name: name,
      }),
    });

    if (result) {
      showToast('Kebutuhan berhasil diperbarui');
      closeModal('edit-need-modal');
      loadNeeds();
    }
  } catch (error) {
    console.error('Error updating need:', error);
    showToast('Gagal memperbarui kebutuhan', 'error');
  }
}

// Add page
async function addPage() {
  const name = document.getElementById('page-name').value.trim();

  if (!name) {
    showToast('Nama halaman tidak boleh kosong', 'error');
    return;
  }

  try {
    const result = await apiRequest('/pages/add', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    if (result) {
      showToast('Halaman berhasil ditambahkan');
      closeModal('add-page-modal');
      loadPages();
      loadDashboardData(); // Refresh counts
    }
  } catch (error) {
    console.error('Error adding page:', error);
    showToast('Gagal menambahkan halaman', 'error');
  }
}

// Open edit page modal
function openEditPageModal(id, name) {
  document.getElementById('edit-page-id').value = id;
  document.getElementById('edit-page-name').value = name;
  openModal('edit-page-modal');
}

// Update page
async function updatePage() {
  const id = document.getElementById('edit-page-id').value;
  const name = document.getElementById('edit-page-name').value.trim();

  if (!name) {
    showToast('Nama halaman tidak boleh kosong', 'error');
    return;
  }

  try {
    const result = await apiRequest('/pages/update', {
      method: 'PUT',
      body: JSON.stringify({
        page_id: parseInt(id),
        name: name,
      }),
    });

    if (result) {
      showToast('Halaman berhasil diperbarui');
      closeModal('edit-page-modal');
      loadPages();
    }
  } catch (error) {
    console.error('Error updating page:', error);
    showToast('Gagal memperbarui halaman', 'error');
  }
}

// Add status
async function addStatus() {
  const name = document.getElementById('status-name').value.trim();

  if (!name) {
    showToast('Nama status tidak boleh kosong', 'error');
    return;
  }

  try {
    const result = await apiRequest('/status/add', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    if (result) {
      showToast('Status berhasil ditambahkan');
      closeModal('add-status-modal');
      loadStatus();
    }
  } catch (error) {
    console.error('Error adding status:', error);
    showToast('Gagal menambahkan status', 'error');
  }
}

// Open edit status modal
function openEditStatusModal(id, name) {
  document.getElementById('edit-status-id').value = id;
  document.getElementById('edit-status-name').value = name;
  openModal('edit-status-modal');
}

// Update status
async function updateStatus() {
  const id = document.getElementById('edit-status-id').value;
  const name = document.getElementById('edit-status-name').value.trim();

  if (!name) {
    showToast('Nama status tidak boleh kosong', 'error');
    return;
  }

  // Since we don't have an update endpoint for status, we'll show a message
  showToast('Fitur update status akan segera hadir', 'warning');
  closeModal('edit-status-modal');
}

// Add color
async function addColor() {
  const name = document.getElementById('color-name').value.trim();
  const hexCode = document.getElementById('color-hex').value.trim();

  if (!name || !hexCode) {
    showToast('Nama dan kode hex warna tidak boleh kosong', 'error');
    return;
  }

  // Validate hex code format
  if (!/^#([0-9A-F]{3}){1,2}$/i.test(hexCode)) {
    showToast('Format kode hex warna tidak valid', 'error');
    return;
  }

  try {
    const result = await apiRequest('/colors/add', {
      method: 'POST',
      body: JSON.stringify({ name, hex_code: hexCode }),
    });

    if (result) {
      showToast('Warna berhasil ditambahkan');
      closeModal('add-color-modal');
      loadColors();
      loadDashboardData(); // Refresh counts
    }
  } catch (error) {
    console.error('Error adding color:', error);
    showToast('Gagal menambahkan warna', 'error');
  }
}

// Open edit color modal
function openEditColorModal(id, name, hex) {
  document.getElementById('edit-color-id').value = id;
  document.getElementById('edit-color-name').value = name;
  document.getElementById('edit-color-hex').value = hex;
  openModal('edit-color-modal');
}

// Update color
async function updateColor() {
  const id = document.getElementById('edit-color-id').value;
  const name = document.getElementById('edit-color-name').value.trim();
  const hexCode = document.getElementById('edit-color-hex').value.trim();

  if (!name || !hexCode) {
    showToast('Nama dan kode hex warna tidak boleh kosong', 'error');
    return;
  }

  // Validate hex code format
  if (!/^#([0-9A-F]{3}){1,2}$/i.test(hexCode)) {
    showToast('Format kode hex warna tidak valid', 'error');
    return;
  }

  // Since we don't have an update endpoint for colors, we'll show a message
  showToast('Fitur update warna akan segera hadir', 'warning');
  closeModal('edit-color-modal');
}

async function deleteNeed(id) {
  if (confirm('Apakah Anda yakin ingin menghapus kebutuhan ini?')) {
    try {
      const result = await apiRequest('/needs/delete', {
        method: 'DELETE',
        body: JSON.stringify({ needs_id: [parseInt(id)] }),
      });

      if (result) {
        showToast('Kebutuhan berhasil dihapus');
        loadNeeds();
        loadDashboardData(); // Refresh counts
      }
    } catch (error) {
      console.error('Error deleting need:', error);
      showToast('Gagal menghapus kebutuhan', 'error');
    }
  }
}

async function deletePage(id) {
  if (confirm('Apakah Anda yakin ingin menghapus halaman ini?')) {
    try {
      const result = await apiRequest('/pages/delete', {
        method: 'DELETE',
        body: JSON.stringify({ pages_id: [parseInt(id)] }),
      });

      if (result) {
        showToast('Halaman berhasil dihapus');
        loadPages();
        loadDashboardData(); // Refresh counts
      }
    } catch (error) {
      console.error('Error deleting page:', error);
      showToast('Gagal menghapus halaman', 'error');
    }
  }
}

async function deleteStatus(id) {
  if (confirm('Apakah Anda yakin ingin menghapus status ini?')) {
    try {
      const result = await apiRequest('/status/delete', {
        method: 'DELETE',
        body: JSON.stringify({ status_id: [parseInt(id)] }),
      });

      if (result) {
        showToast('Status berhasil dihapus');
        loadStatus();
      }
    } catch (error) {
      console.error('Error deleting status:', error);
      showToast('Gagal menghapus status', 'error');
    }
  }
}

async function deleteColor(id) {
  if (confirm('Apakah Anda yakin ingin menghapus warna ini?')) {
    try {
      const result = await apiRequest('/colors/delete', {
        method: 'DELETE',
        body: JSON.stringify({ colors_id: [parseInt(id)] }),
      });

      if (result) {
        showToast('Warna berhasil dihapus');
        loadColors();
        loadDashboardData(); // Refresh counts
      }
    } catch (error) {
      console.error('Error deleting color:', error);
      showToast('Gagal menghapus warna', 'error');
    }
  }
}

// Logout function
async function logout() {
  try {
    // Panggil logout endpoint untuk clear server-side session
    await fetch(`${API_BASE_URL}/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Error during logout API call:', error);
  } finally {
    // Clear client-side data dan redirect
    clearAuthData();
    window.location.href = 'index.html';
  }
}
