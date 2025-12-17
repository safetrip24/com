// Wrap everything in IIFE to avoid global scope conflicts
(function() {
'use strict';

// Supabase initialization
const supabaseUrl = 'https://dltekkanbmeffojygudt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsdGVra2FuYm1lZmZvanlndWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5MzI4NzIsImV4cCI6MjA3MzUwODg3Mn0.CAUt2mANz1Q1yCblK4Va4CX2ekH_-5vrfUB_nvugMyg';
let supabase = null;

// DOM Elements - will be initialized after DOM is ready
let contactBtn = null;
let contactModal = null;
let loginBtn = null;
let signupBtn = null;
let authModal = null;
let authModalTitle = null;
let authForm = null;
let authSwitch = null;
let authSubmit = null;
let signupFields = null;
let shipmentForm = null;
let trackingResult = null;
let trackingNumberElement = null;
let trackingForm = null;
let trackingInput = null;
let trackingResultContainer = null;
let trackingStatus = null;
let trackingOrigin = null;
let trackingDestination = null;
let trackingDelivery = null;
let trackingUpdated = null;
let trackingNotes = null;
let shipmentHistoryBtn = null;
let shipmentActivitiesBody = null;
let shipmentHistoryDetails = null;
let shipmentHistoryModalEl = null;
let shipmentHistoryModal = null;

// Build a synthetic current snapshot row from a shipment
function buildCurrentSnapshotRow(shipment) {
    if (!shipment) return null;
    return {
        tracking_timestamp: shipment.last_updated || shipment.updated_at || null,
        description: (shipment.notes && shipment.notes.trim()) || shipment.status || '',
        status: shipment.status || '',
        location: shipment.current_location || shipment.origin || ''
    };
}

// If the latest activity is newer than the shipment snapshot, use its timestamp/description/location
function mergeSnapshotWithLatestActivity(snapshot, activities) {
    if (!snapshot) return null;
    if (!Array.isArray(activities) || activities.length === 0) return snapshot;
    const latest = activities[0];
    const snapTime = snapshot.tracking_timestamp ? new Date(snapshot.tracking_timestamp).getTime() : 0;
    const actTime = latest.tracking_timestamp ? new Date(latest.tracking_timestamp).getTime() : 0;
    if (actTime > snapTime) {
        return {
            tracking_timestamp: latest.tracking_timestamp,
            description: latest.description || latest.status || snapshot.description || '',
            status: snapshot.status || '',
            location: latest.location || snapshot.location || ''
        };
    }
    return snapshot;
}

// Helpers for rendering activities; order: current snapshot → ephemeral → DB activities
function renderActivitiesTable(dbActivities, prependRows = [], ephemeralRows = []) {
    const activitiesFromDb = Array.isArray(dbActivities) ? dbActivities.slice() : [];
    activitiesFromDb.sort((a, b) => new Date(b.tracking_timestamp || 0) - new Date(a.tracking_timestamp || 0));

    const currentSnapshotRows = Array.isArray(prependRows) ? prependRows : (prependRows ? [prependRows] : []);
    const ephemeral = Array.isArray(ephemeralRows) ? ephemeralRows : [];

    // Deduplicate by timestamp|description|location while preserving order: snapshot → ephemeral → db
    const seen = new Set();
    const makeKey = (r) => `${r.tracking_timestamp || ''}|${r.description || r.status || ''}|${r.location || ''}`;

    const ordered = [];
    [...currentSnapshotRows, ...ephemeral, ...activitiesFromDb].forEach(r => {
        if (!r) return;
        const key = makeKey(r);
        if (seen.has(key)) return;
        seen.add(key);
        ordered.push(r);
    });

    const limited = ordered.slice(0, 10);

    if (shipmentActivitiesBody) {
        if (!limited.length) {
            shipmentActivitiesBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No activities yet.</td></tr>`;
            return;
        }
        shipmentActivitiesBody.innerHTML = limited.map(a => `
            <tr>
                <td>${a.tracking_timestamp ? new Date(a.tracking_timestamp).toLocaleString() : ''}</td>
                <td>${a.description || a.status || ''}</td>
                <td>${a.location || ''}</td>
            </tr>
        `).join('');
    }
}
const senderCityInput = document.getElementById('senderCity');
const senderCountryInput = document.getElementById('senderCountry');
const receiverCityInput = document.getElementById('receiverCity');
const receiverCountryInput = document.getElementById('receiverCountry');

// State variables
let isLoginMode = true;
let map = null;
let shipmentRoute = null;
let currentTrackedShipment = null;
let ephemeralActivities = [];

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Supabase - UMD build exposes it as window.supabase.createClient
    function initSupabase() {
        if (supabase) return true;
        
        // Try window.supabase.createClient (CDN UMD build)
        if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
            try {
                supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
                console.log('Supabase initialized successfully');
                return true;
            } catch (error) {
                console.error('Error initializing Supabase:', error);
                return false;
            }
        }
        return false;
    }
    
    // Try to initialize immediately
    if (!initSupabase()) {
        // If not available, retry with increasing delays
        let retries = 0;
        const maxRetries = 10;
        const retryInterval = setInterval(() => {
            retries++;
            if (initSupabase()) {
                clearInterval(retryInterval);
                // Re-run setup functions now that Supabase is ready
                checkAuthState();
                setupRealtimeUpdates();
            } else if (retries >= maxRetries) {
                clearInterval(retryInterval);
                console.error('Supabase library not loaded after multiple retries. Please ensure @supabase/supabase-js is loaded before script.js');
                alert('Error: Supabase client failed to initialize. Please refresh the page.');
            }
        }, 100);
    }
    
    // Initialize DOM Elements
    contactBtn = document.getElementById('contactBtn');
    const contactModalEl = document.getElementById('contactModal');
    contactModal = contactModalEl && typeof bootstrap !== 'undefined' ? new bootstrap.Modal(contactModalEl) : null;
    loginBtn = document.getElementById('loginBtn');
    signupBtn = document.getElementById('signupBtn');
    const authModalEl = document.getElementById('authModal');
    authModal = authModalEl && typeof bootstrap !== 'undefined' ? new bootstrap.Modal(authModalEl) : null;
    authModalTitle = document.getElementById('authModalTitle');
    authForm = document.getElementById('authForm');
    authSwitch = document.getElementById('authSwitch');
    authSubmit = document.getElementById('authSubmit');
    signupFields = document.getElementById('signupFields');
    shipmentForm = document.getElementById('shipmentForm');
    trackingResult = document.getElementById('trackingResult');
    trackingNumberElement = document.getElementById('trackingNumber');
    trackingForm = document.getElementById('trackingForm');
    trackingInput = document.getElementById('trackingInput');
    trackingResultContainer = document.getElementById('trackingResultContainer');
    trackingStatus = document.getElementById('trackingStatus');
    trackingOrigin = document.getElementById('trackingOrigin');
    trackingDestination = document.getElementById('trackingDestination');
    trackingDelivery = document.getElementById('trackingDelivery');
    trackingUpdated = document.getElementById('trackingUpdated');
    trackingNotes = document.getElementById('trackingNotes');
    shipmentHistoryBtn = document.getElementById('shipmentHistoryBtn');
    shipmentActivitiesBody = document.getElementById('shipmentActivitiesBody');
    shipmentHistoryDetails = document.getElementById('shipmentHistoryDetails');
    shipmentHistoryModalEl = document.getElementById('shipmentHistoryModal');
    shipmentHistoryModal = shipmentHistoryModalEl && typeof bootstrap !== 'undefined' ? new bootstrap.Modal(shipmentHistoryModalEl) : null;
    
    // Contact modal
    if (contactBtn && contactModal) {
        contactBtn.addEventListener('click', function(e) {
            e.preventDefault();
            contactModal.show();
        });
    }
    
    // Auth modals
    if (loginBtn && authModal) {
        loginBtn.addEventListener('click', function() {
            isLoginMode = true;
            if (authModalTitle) authModalTitle.textContent = 'Login';
            if (authSubmit) authSubmit.textContent = 'Login';
            if (signupFields) signupFields.style.display = 'none';
            if (authSwitch) authSwitch.textContent = "Don't have an account? Sign up";
            authModal.show();
        });
    }
    
    if (signupBtn && authModal) {
        signupBtn.addEventListener('click', function() {
            isLoginMode = false;
            if (authModalTitle) authModalTitle.textContent = 'Sign Up';
            if (authSubmit) authSubmit.textContent = 'Sign Up';
            if (signupFields) signupFields.style.display = 'block';
            if (authSwitch) authSwitch.textContent = "Already have an account? Login";
            authModal.show();
        });
    }
    
    if (authSwitch) {
        authSwitch.addEventListener('click', function(e) {
            e.preventDefault();
            isLoginMode = !isLoginMode;
            
            if (isLoginMode) {
                if (authModalTitle) authModalTitle.textContent = 'Login';
                if (authSubmit) authSubmit.textContent = 'Login';
                if (signupFields) signupFields.style.display = 'none';
                if (authSwitch) authSwitch.textContent = "Don't have an account? Sign up";
            } else {
                if (authModalTitle) authModalTitle.textContent = 'Sign Up';
                if (authSubmit) authSubmit.textContent = 'Sign Up';
                if (signupFields) signupFields.style.display = 'block';
                if (authSwitch) authSwitch.textContent = "Already have an account? Login";
            }
        });
    }
    
    // Auth form submission
    if (authForm) {
        authForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            if (!supabase) {
                alert('Error: Supabase client not initialized. Please refresh the page.');
                return;
            }
            
            const email = document.getElementById('authEmail').value;
            const password = document.getElementById('authPassword').value;
            
            try {
                if (isLoginMode) {
                    // Login
                    const { data, error } = await supabase.auth.signInWithPassword({
                        email: email,
                        password: password
                    });
                    
                    if (error) throw error;
                    
                    alert('Login successful!');
                    if (authModal) authModal.hide();
                } else {
                    // Sign up
                    const fullName = document.getElementById('fullName').value;
                    const { data, error } = await supabase.auth.signUp({
                        email: email,
                        password: password,
                        options: {
                            data: {
                                full_name: fullName
                            }
                        }
                    });
                    
                    if (error) throw error;
                    
                    alert('Sign up successful! Please check your email for verification.');
                    if (authModal) authModal.hide();
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        });
    }
    
    // Shipment form submission
    if (shipmentForm) {
        shipmentForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Check if user is logged in
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                alert('Please log in to register a shipment');
                if (loginBtn) loginBtn.click();
                return;
            }
            
            // Generate tracking number
            const trackingNumber = 'ST' + Date.now() + Math.floor(Math.random() * 1000);
            
            // Compose full addresses with city and country/state
            const senderAddress = document.getElementById('senderAddress').value;
            const senderCity = senderCityInput ? senderCityInput.value : '';
            const senderCountry = senderCountryInput ? senderCountryInput.value : '';
            const receiverAddress = document.getElementById('receiverAddress').value;
            const receiverCity = receiverCityInput ? receiverCityInput.value : '';
            const receiverCountry = receiverCountryInput ? receiverCountryInput.value : '';

            const originFull = [senderAddress, senderCity, senderCountry].filter(Boolean).join(', ');
            const destinationFull = [receiverAddress, receiverCity, receiverCountry].filter(Boolean).join(', ');

            // Prepare shipment data
            const shipmentData = {
                tracking_number: trackingNumber,
                sender_name: document.getElementById('senderName').value,
                sender_email: document.getElementById('senderEmail').value,
                sender_phone: document.getElementById('senderPhone').value,
                sender_address: senderAddress,
                receiver_name: document.getElementById('receiverName').value,
                receiver_phone: document.getElementById('receiverPhone').value,
                receiver_address: receiverAddress,
                package_description: document.getElementById('packageDescription').value,
                package_weight: document.getElementById('packageWeight').value,
                package_value: document.getElementById('packageValue').value,
                status: 'Registered',
                user_id: user.id,
                current_location: originFull,
                origin: originFull,
                destination: destinationFull,
                estimated_delivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                last_updated: new Date().toISOString()
            };
            
            try {
                // Insert into shipments table
                const { data, error } = await supabase
                    .from('shipments')
                    .insert([shipmentData]);
                
                if (error) throw error;
                
                // Show tracking number
                if (trackingNumberElement) trackingNumberElement.textContent = trackingNumber;
                if (trackingResult) trackingResult.style.display = 'block';
                
                // Reset form
                shipmentForm.reset();
                
                alert('Shipment registered successfully! Your tracking number is ' + trackingNumber);
            } catch (error) {
                alert('Error: ' + error.message);
            }
        });
    }
    
    // Tracking form submission
    if (trackingForm) {
        trackingForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            if (!supabase) {
                alert('Error: Supabase client not initialized. Please refresh the page.');
                return;
            }
            
            const trackingNumber = trackingInput ? trackingInput.value.trim() : '';
            
            if (!trackingNumber) {
                alert('Please enter a tracking number');
                return;
            }
            
            try {
                // Fetch shipment data
                const { data: shipments, error } = await supabase
                    .from('shipments')
                    .select('*')
                    .eq('tracking_number', trackingNumber);
                
                if (error) throw error;
                
                if (shipments.length === 0) {
                    alert('No shipment found with that tracking number');
                    return;
                }
                
                const shipment = shipments[0];
                currentTrackedShipment = shipment;
                ephemeralActivities = [];
                
                // Update tracking details
                if (trackingStatus) trackingStatus.textContent = shipment.status;
                if (trackingOrigin) trackingOrigin.textContent = shipment.origin;
                if (trackingDestination) trackingDestination.textContent = shipment.destination;
                if (trackingDelivery) trackingDelivery.textContent = shipment.estimated_delivery;
                if (trackingUpdated) trackingUpdated.textContent = new Date(shipment.last_updated).toLocaleString();
                if (trackingNotes) trackingNotes.textContent = shipment.notes || '';
                // Stash shipment on DOM for history button
                if (trackingResultContainer) {
                    trackingResultContainer.dataset.currentShipmentId = shipment.id;
                    trackingResultContainer.dataset.currentTrackingNumber = shipment.tracking_number;
                }
                
                // Show tracking result
                if (trackingResultContainer) trackingResultContainer.style.display = 'block';
                
                // Initialize map if not already done and Leaflet is available
                if (typeof L !== 'undefined') {
                    if (!map) {
                        map = L.map('map');
                        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                            attribution: '&copy; OpenStreetMap contributors'
                        }).addTo(map);
                    } else {
                        map.eachLayer(layer => {
                            if (layer instanceof L.Polyline || layer instanceof L.Marker) {
                                map.removeLayer(layer);
                            }
                        });
                    }
                    
                    // Geocode and render markers based on real locations
                    const geocode = async (query) => {
                        if (!query) return null;
                        const url = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query);
                        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
                        const results = await resp.json();
                        if (Array.isArray(results) && results.length > 0) {
                            return [parseFloat(results[0].lat), parseFloat(results[0].lon)];
                        }
                        return null;
                    };

                    const [originCoords, destCoords, currentCoords] = await Promise.all([
                        geocode(shipment.origin),
                        geocode(shipment.destination),
                        geocode(shipment.current_location)
                    ]);

                    const markers = [];
                    if (originCoords) {
                        markers.push(L.marker(originCoords).addTo(map).bindPopup('Origin: ' + shipment.origin));
                    }
                    if (destCoords) {
                        markers.push(L.marker(destCoords).addTo(map).bindPopup('Destination: ' + shipment.destination));
                    }
                    if (currentCoords) {
                        markers.push(L.marker(currentCoords).addTo(map).bindPopup('Current Location: ' + shipment.current_location).openPopup());
                    }

                    if (originCoords && destCoords) {
                        shipmentRoute = L.polyline([originCoords, destCoords], { color: 'blue' }).addTo(map);
                        map.fitBounds(shipmentRoute.getBounds());
                    } else if (markers.length > 0) {
                        const group = L.featureGroup(markers);
                        map.fitBounds(group.getBounds());
                    } else {
                        map.setView([51.505, -0.09], 5);
                    }
                }
                
            } catch (error) {
                alert('Error: ' + error.message);
            }
        });
    }

    // Shipment History button
    if (shipmentHistoryBtn) {
        shipmentHistoryBtn.addEventListener('click', async function() {
            const shipmentId = trackingResultContainer ? trackingResultContainer.dataset.currentShipmentId : null;
            const trackingNumber = trackingResultContainer ? trackingResultContainer.dataset.currentTrackingNumber : null;
            if (!shipmentId || !trackingNumber) {
                alert('Please search with a tracking number first.');
                return;
            }

            try {
                // Fetch full shipment for details (including sender/receiver, package description)
                const { data: shipments, error: shipmentErr } = await supabase
                    .from('shipments')
                    .select('*')
                    .eq('id', shipmentId)
                    .limit(1);
                if (shipmentErr) throw shipmentErr;
                const shipment = shipments && shipments.length ? shipments[0] : null;
                currentTrackedShipment = shipment;
                ephemeralActivities = [];

                // Render details section
                if (shipmentHistoryDetails && shipment) {
                    shipmentHistoryDetails.innerHTML = `
                        <div class="col-md-6">
                            <p class="mb-1"><strong>Tracking Number:</strong> ${shipment.tracking_number}</p>
                            <p class="mb-1"><strong>Package:</strong> ${shipment.package_description}</p>
                            <p class="mb-1"><strong>Status:</strong> ${shipment.status}</p>
                            <p class="mb-1"><strong>Origin:</strong> ${shipment.origin}</p>
                            <p class="mb-1"><strong>Destination:</strong> ${shipment.destination}</p>
                            <p class="mb-1"><strong>Estimated Delivery:</strong> ${shipment.estimated_delivery ?? ''}</p>
                        </div>
                        <div class="col-md-6">
                            <p class="mb-1"><strong>Shipper:</strong> ${shipment.sender_name}</p>
                            <p class="mb-1"><strong>Shipper Address:</strong> ${shipment.sender_address}</p>
                            <p class="mb-1"><strong>Receiver:</strong> ${shipment.receiver_name}</p>
                            <p class="mb-1"><strong>Receiver Address:</strong> ${shipment.receiver_address}</p>
                            <p class="mb-1"><strong>Created:</strong> ${shipment.created_at ? new Date(shipment.created_at).toLocaleString() : ''}</p>
                            <p class="mb-1"><strong>Last Updated:</strong> ${shipment.last_updated ? new Date(shipment.last_updated).toLocaleString() : ''}</p>
                        </div>
                    `;
                }

                // Fetch tracking activities via RPC (bypasses RLS for public tracking by number)
                const { data: rpcActivities, error: activitiesErr } = await supabase
                    .rpc('get_shipment_tracking', { p_tracking_number: trackingNumber });
                if (activitiesErr) throw activitiesErr;
                const activities = Array.isArray(rpcActivities)
                    ? rpcActivities.sort((a, b) => new Date(b.tracking_timestamp) - new Date(a.tracking_timestamp)).slice(0, 10)
                    : [];

                // Render current snapshot (merged with latest activity time if newer) on top + ephemeral + activities
                let currentRow = buildCurrentSnapshotRow(currentTrackedShipment);
                currentRow = mergeSnapshotWithLatestActivity(currentRow, activities);
                renderActivitiesTable(activities, currentRow ? [currentRow] : [], ephemeralActivities);

                if (shipmentHistoryModal) shipmentHistoryModal.show();
            } catch (err) {
                alert('Error loading history: ' + err.message);
            }
        });
    }
    
    // Check if user is logged in
    checkAuthState();
    
    // Set up real-time subscription for shipment updates
    setupRealtimeUpdates();
});

// Check authentication state
async function checkAuthState() {
    if (!supabase) return;
    
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
        if (loginBtn) {
            loginBtn.textContent = 'Logout';
            // Remove existing click listeners by cloning and replacing
            const newLoginBtn = loginBtn.cloneNode(true);
            loginBtn.parentNode.replaceChild(newLoginBtn, loginBtn);
            loginBtn = newLoginBtn;
            
            loginBtn.addEventListener('click', async function(e) {
                e.preventDefault();
                await supabase.auth.signOut();
                window.location.reload();
            });
        }
        if (signupBtn) signupBtn.style.display = 'none';
    } else {
        // User is not logged in, ensure buttons work normally
        if (loginBtn && loginBtn.textContent === 'Logout') {
            loginBtn.textContent = 'Login';
        }
        if (signupBtn) signupBtn.style.display = '';
    }
}

// Set up real-time updates for shipments
function setupRealtimeUpdates() {
    if (!supabase) {
        console.warn('Supabase not initialized, skipping real-time updates setup');
        return;
    }
    
    const shipmentsSubscription = supabase
        .channel('shipments-changes')
        .on('postgres_changes', 
            { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'shipments' 
            }, 
            (payload) => {
                // If we're currently tracking this shipment, update the map
                if (trackingInput && trackingInput.value === payload.new.tracking_number) {
                    // Capture previous snapshot BEFORE updating to new, so it can slide down
                    const previousSnapshot = buildCurrentSnapshotRow(currentTrackedShipment);
                    // Update cached shipment for current snapshot row
                    currentTrackedShipment = payload.new;
                    // Update the tracking info
                    if (trackingStatus) trackingStatus.textContent = payload.new.status;
                    if (trackingUpdated) trackingUpdated.textContent = new Date(payload.new.last_updated).toLocaleString();
                    
                    // Update the map if it exists and Leaflet is available
                    if (map && typeof L !== 'undefined') {
                        // Remove existing non-tile layers
                        map.eachLayer(layer => {
                            if (layer instanceof L.Polyline || layer instanceof L.Marker) {
                                map.removeLayer(layer);
                            }
                        });

                        const geocode = async (query) => {
                            if (!query) return null;
                            const url = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query);
                            const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
                            const results = await resp.json();
                            if (Array.isArray(results) && results.length > 0) {
                                return [parseFloat(results[0].lat), parseFloat(results[0].lon)];
                            }
                            return null;
                        };

                        (async () => {
                            if (trackingNotes) trackingNotes.textContent = payload.new.notes || '';
                            const [originCoords, destCoords, currentCoords] = await Promise.all([
                                geocode(payload.new.origin),
                                geocode(payload.new.destination),
                                geocode(payload.new.current_location)
                            ]);

                            const markers = [];
                            if (originCoords) markers.push(L.marker(originCoords).addTo(map).bindPopup('Origin: ' + payload.new.origin));
                            if (destCoords) markers.push(L.marker(destCoords).addTo(map).bindPopup('Destination: ' + payload.new.destination));
                            if (currentCoords) markers.push(L.marker(currentCoords).addTo(map).bindPopup('Current Location: ' + payload.new.current_location).openPopup());

                            if (originCoords && destCoords) {
                                shipmentRoute = L.polyline([originCoords, destCoords], { color: 'blue' }).addTo(map);
                                map.fitBounds(shipmentRoute.getBounds());
                            } else if (markers.length > 0) {
                                const group = L.featureGroup(markers);
                                map.fitBounds(group.getBounds());
                            }
                        })();
                    }

                    // If history modal open, refresh the table to show the latest status as the top row
                    (async () => {
                        const open = shipmentHistoryModalEl && shipmentHistoryModalEl.classList.contains('show');
                        const currentId = trackingResultContainer ? trackingResultContainer.dataset.currentShipmentId : null;
                        if (!open || !currentId) return;
                        // Push the captured previous snapshot into ephemeral history
                        if (previousSnapshot) {
                            const key = `${previousSnapshot.tracking_timestamp}|${previousSnapshot.description}|${previousSnapshot.location}`;
                            const exists = ephemeralActivities.some(r => `${r.tracking_timestamp}|${r.description}|${r.location}` === key);
                            if (!exists) {
                                ephemeralActivities.unshift(previousSnapshot);
                                if (ephemeralActivities.length > 9) ephemeralActivities = ephemeralActivities.slice(0, 9);
                            }
                        }
                        const trackingNumber = trackingResultContainer ? trackingResultContainer.dataset.currentTrackingNumber : null;
                        const { data: rpcActivities } = await supabase
                            .rpc('get_shipment_tracking', { p_tracking_number: trackingNumber });
                        const activities = Array.isArray(rpcActivities)
                            ? rpcActivities.sort((a, b) => new Date(b.tracking_timestamp) - new Date(a.tracking_timestamp)).slice(0, 10)
                            : [];
                        let currentRow = buildCurrentSnapshotRow(currentTrackedShipment);
                        currentRow = mergeSnapshotWithLatestActivity(currentRow, activities);
                        renderActivitiesTable(activities, currentRow ? [currentRow] : [], ephemeralActivities);
                    })();
                }
            }
        )
        .subscribe();

    // Real-time activities for currently open shipment history modal
    const trackingSubscription = supabase
        .channel('shipment-tracking-changes')
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'shipment_tracking'
            },
            async (payload) => {
                const open = shipmentHistoryModalEl && shipmentHistoryModalEl.classList.contains('show');
                const currentId = trackingResultContainer ? trackingResultContainer.dataset.currentShipmentId : null;
                if (!open || !currentId) return;
                // Only refresh if event relates to current shipment
                const changedShipmentId = payload.new ? payload.new.shipment_id : (payload.old ? payload.old.shipment_id : null);
                if (changedShipmentId !== currentId) return;

                // Re-fetch activities and include current snapshot
                const trackingNumber = trackingResultContainer ? trackingResultContainer.dataset.currentTrackingNumber : null;
                const { data: rpcActivities } = await supabase
                    .rpc('get_shipment_tracking', { p_tracking_number: trackingNumber });
                const activities = Array.isArray(rpcActivities)
                    ? rpcActivities.sort((a, b) => new Date(b.tracking_timestamp) - new Date(a.tracking_timestamp)).slice(0, 10)
                    : [];
                let currentRow = buildCurrentSnapshotRow(currentTrackedShipment);
                currentRow = mergeSnapshotWithLatestActivity(currentRow, activities);
                renderActivitiesTable(activities, currentRow ? [currentRow] : [], ephemeralActivities);
            }
        )
        .subscribe();
}

})(); // End of IIFE