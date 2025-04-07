// Initialize Firebase database
const db = firebase.database();

// Function to format datetime
const formatDateTime = (timestamp) => {
    // Convert Unix timestamp (in seconds) to milliseconds
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-HK', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
};

// Function to update RFID records display
async function updateRFIDRecords(records, authorizedStaff) {
    const tbody = document.getElementById('rfid-records');
    tbody.innerHTML = ''; // Clear existing rows

    if (!records || records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">No access records available</td></tr>';
        return;
    }

    console.log('Processing records with authorized list:', authorizedStaff); // Debug log

    records.forEach(record => {
        const row = document.createElement('tr');
        // Check if the staff number is in the authorized list
        const staffNo = record.StaffNo;
        console.log('Checking staff number:', staffNo, 'against authorized list'); // Debug log
        const isAuthorized = staffNo && authorizedStaff.includes(staffNo);
        const statusClass = isAuthorized ? 'status-authorized' : 'status-unauthorized';
        const statusText = isAuthorized ? 'Authorized' : 'Unauthorized';
        
        row.innerHTML = `
            <td>${formatDateTime(record.timestamp)}</td>
            <td>${staffNo || 'Unknown'}</td>
            <td class="${statusClass}">${statusText}</td>
        `;
        tbody.appendChild(row);
    });
}

// Function to fetch authorized staff list
async function fetchAuthorizedStaff() {
    try {
        // Use the company-wide authorized RFID numbers path
        const staffRef = db.ref('company/authorized_RFID_no');
        const snapshot = await staffRef.once('value');
        const authorizedStaff = [];
        
        // Get all keys from the authorized_RFID_no object
        if (snapshot.exists()) {
            Object.keys(snapshot.val()).forEach(staffNo => {
                authorizedStaff.push(staffNo);
            });
        }
        
        console.log('Authorized staff list:', authorizedStaff); // Debug log
        return authorizedStaff;
    } catch (error) {
        console.error('Error fetching authorized staff list:', error);
        return [];
    }
}

// Function to fetch RFID records
function fetchRFIDRecords(userId) {
    try {
        // Get reference to RFID records
        const rfidRef = db.ref(`users/${userId}/RFID`);
        
        // Set up a real-time listener for RFID records
        rfidRef.orderByKey().limitToLast(20).on('value', async (rfidSnapshot) => {
            // Fetch authorized staff list
            const authorizedStaff = await fetchAuthorizedStaff();
            
            const records = [];
            rfidSnapshot.forEach((child) => {
                // Each child is a timestamp entry with StaffNo
                records.push({
                    timestamp: parseInt(child.key),
                    StaffNo: child.child('StaffNo').val(),
                    key: child.key
                });
            });

            // Sort records by timestamp in descending order
            records.sort((a, b) => b.timestamp - a.timestamp);
            
            // Update display with both records and authorized staff list
            updateRFIDRecords(records, authorizedStaff);
        }, (error) => {
            console.error('Error fetching RFID records:', error);
            document.getElementById('rfid-records').innerHTML = 
                '<tr><td colspan="3">Error loading RFID records. Please try again later.</td></tr>';
        });
    } catch (error) {
        console.error('Error setting up RFID listener:', error);
        document.getElementById('rfid-records').innerHTML = 
            '<tr><td colspan="3">Error loading RFID records. Please try again later.</td></tr>';
    }
}

// Initialize when document is ready and user is authenticated
document.addEventListener('DOMContentLoaded', function() {
    firebase.auth().onAuthStateChanged(function(user) {
        if (user) {
            // User is signed in
            console.log('User is signed in:', user.uid);
            fetchRFIDRecords(user.uid);
            
            // Clean up listeners when user logs out
            return () => {
                const rfidRef = db.ref(`users/${user.uid}/RFID`);
                rfidRef.off(); // Remove all listeners
            };
        } else {
            // No user is signed in
            console.log('No user is signed in');
            window.location.href = '../login/PowerLink.html';
        }
    });
}); 