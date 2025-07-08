// Initialize Firebase (Add your config)
const firebaseConfig = {
    apiKey: "AIzaSyB-MtbsHu9_dEGQkEo3Y46rxgIeg5vhfR8",
    authDomain: "fir-a5ed4.firebaseapp.com",
    databaseURL: "https://fir-a5ed4-default-rtdb.firebaseio.com",
    projectId: "fir-a5ed4",
    storageBucket: "fir-a5ed4.firebasestorage.app",
    messagingSenderId: "30349602179",
    appId: "1:30349602179:web:6f2ea8b2efaf20a74a9ab6"
};

// Initialize Firebase with error handling
let db;
try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    db = firebase.database();
    console.log("Firebase initialized successfully");
} catch (error) {
    console.error("Firebase initialization error:", error);
}

// Initialize the charts
var voltageChartContext = document.getElementById('consumptionChart').getContext('2d');
var currentChartContext = document.getElementById('currentChart').getContext('2d');
var voltageChart;
var currentChart;
var isLoading = false;

// Function to show loading state
function showLoading() {
    if (!isLoading) {
        isLoading = true;
        document.getElementById('lastUpdate').innerHTML = 'Loading data...';
    }
}

// Function to initialize charts with real-time updates
function initializeCharts() {
    // Check if user is authenticated
    const user = firebase.auth().currentUser;
    if (!user) {
        console.error('No user is signed in');
        document.getElementById('lastUpdate').innerHTML = 'Please sign in to view data';
        return;
    }

    console.log('Initializing consumption charts for user:', user.uid);
    const voltageRef = db.ref(`users/${user.uid}/data/Electricity_transmission_(Voltage)`);
    const currentRef = db.ref(`users/${user.uid}/data/Electricity_transmission_(Current)`);
    
    console.log('Setting up voltage listener at:', voltageRef.toString());
    // Listen for real-time updates for voltage
    voltageRef.orderByChild('timestamp')
        .limitToLast(20)
        .on('value', (snapshot) => {
            console.log('Voltage data received:', snapshot.val());
            if (snapshot.exists()) {
                const voltageData = [];
                snapshot.forEach((child) => {
                    const value = child.val();
                    console.log('Processing voltage reading:', value);
                    // Add validation for the value
                    if (value && typeof value.timestamp === 'number' && typeof value.value === 'number') {
                        voltageData.push({
                            timestamp: new Date(value.timestamp * 1000),
                            value: value.value
                        });
                    } else {
                        console.warn('Invalid voltage reading:', value);
                    }
                });
                
                if (voltageData.length > 0) {
                    // Sort data by timestamp
                    voltageData.sort((a, b) => a.timestamp - b.timestamp);
                    console.log('Processed voltage data:', voltageData);
                    updateVoltageChart(voltageData);
                } else {
                    console.warn('No valid voltage readings found in the snapshot');
                }
            } else {
                console.log('No voltage data exists in the snapshot');
            }
        }, (error) => {
            console.error('Error fetching voltage data:', error);
            document.getElementById('lastUpdate').innerHTML = 'Error loading voltage data';
        });

    console.log('Setting up current listener at:', currentRef.toString());
    // Listen for real-time updates for current
    currentRef.orderByChild('timestamp')
        .limitToLast(20)
        .on('value', (snapshot) => {
            console.log('Current data received:', snapshot.val());
            if (snapshot.exists()) {
                const currentData = [];
                snapshot.forEach((child) => {
                    const value = child.val();
                    console.log('Processing current reading:', value);
                    currentData.push({
                        timestamp: new Date(value.timestamp * 1000),
                        value: value.value
                    });
                });
                
                // Sort data by timestamp
                currentData.sort((a, b) => a.timestamp - b.timestamp);
                console.log('Processed current data:', currentData);
                updateCurrentChart(currentData);
                
                // Update last reading information with the most recent data
                const lastReading = currentData[currentData.length - 1];
                const lastVoltageReading = voltageChart ? voltageChart.data.datasets[0].data[voltageChart.data.datasets[0].data.length - 1] : 0;
                updateLastReadingInfo({
                    timestamp: lastReading.timestamp,
                    voltage: lastVoltageReading,
                    current: lastReading.value
                });
            } else {
                console.log('No current data exists in the snapshot');
            }
        }, (error) => {
            console.error('Error fetching current data:', error);
            document.getElementById('lastUpdate').innerHTML = 'Error loading current data';
        });
}

function updateVoltageChart(data) {
    console.log('Updating voltage chart with data:', data);
    const labels = data.map(reading => reading.timestamp.toLocaleTimeString());
    const values = data.map(reading => reading.value);
    console.log('Voltage chart labels:', labels);
    console.log('Voltage chart values:', values);

    if (!voltageChart) {
        voltageChart = new Chart(voltageChartContext, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Voltage',
                    data: values,
                    borderColor: '#FF6B6B',
                    backgroundColor: 'rgba(255, 107, 107, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 750
                },
                scales: {
                    yAxes: [{
                        ticks: {
                            beginAtZero: true,
                            max: 15, // Increased from 5 to 10 to accommodate higher voltage values
                            stepSize: 1.5, // Changed from 0.5 to 1 for better readability
                            callback: function(value) {
                                return value + ' V';
                            }
                        },
                        scaleLabel: {
                            display: true,
                            labelString: 'Voltage (V)'
                        }
                    }],
                    xAxes: [{
                        scaleLabel: {
                            display: true,
                            labelString: 'Time'
                        }
                    }]
                },
                title: {
                    display: true,
                    text: 'Electricity Consumption (Voltage)',
                    fontSize: 16,
                    padding: 20
                }
            }
        });
    } else {
        voltageChart.data.labels = labels;
        voltageChart.data.datasets[0].data = values;
        voltageChart.update('none');
    }
}

function updateCurrentChart(data) {
    console.log('Updating current chart with data:', data);
    const labels = data.map(reading => reading.timestamp.toLocaleTimeString());
    const values = data.map(reading => reading.value);
    console.log('Current chart labels:', labels);
    console.log('Current chart values:', values);

    if (!currentChart) {
        currentChart = new Chart(currentChartContext, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Current',
                    data: values,
                    borderColor: '#4A90E2',
                    backgroundColor: 'rgba(74, 144, 226, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 750
                },
                scales: {
                    yAxes: [{
                        ticks: {
                            beginAtZero: true,
                            max: 250,
                            stepSize: 25,
                            callback: function(value) {
                                return value + ' mA';
                            }
                        },
                        scaleLabel: {
                            display: true,
                            labelString: 'Current (mA)'
                        }
                    }],
                    xAxes: [{
                        scaleLabel: {
                            display: true,
                            labelString: 'Time'
                        }
                    }]
                },
                title: {
                    display: true,
                    text: 'Electricity Consumption (Current)',
                    fontSize: 16,
                    padding: 20
                }
            }
        });
    } else {
        currentChart.data.labels = labels;
        currentChart.data.datasets[0].data = values;
        currentChart.update('none');
    }
}

function updateLastReadingInfo(lastReading) {
    document.getElementById('lastUpdate').innerHTML = 
        'Last Updated: ' + lastReading.timestamp.toLocaleString() +
        '<br>Latest voltage: ' + lastReading.voltage.toFixed(2) + ' V' +
        '<br>Latest current: ' + lastReading.current.toFixed(2) + ' mA';
}

// Add this function to check if charts are properly initialized
function checkChartElements() {
    console.log('Checking chart elements...');
    console.log('Consumption chart element:', document.getElementById('consumptionChart'));
    console.log('Current chart element:', document.getElementById('currentChart'));
}

// Initialize when document is ready and user is authenticated
document.addEventListener('DOMContentLoaded', function() {
    checkChartElements();
    
    // Set up authentication state observer
    firebase.auth().onAuthStateChanged(function(user) {
        if (user) {
            // User is signed in
            console.log('User is signed in:', user.uid);
            initializeCharts();
        } else {
            // No user is signed in
            console.log('No user is signed in');
            document.getElementById('lastUpdate').innerHTML = 'Please sign in to view data';
        }
    });
});
