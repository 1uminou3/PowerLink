// Initialize Firebase
const db = firebase.database();

// Rate constants
const ELECTRICITY_RATE = 1.20; // HK$ per kWh
const SOLAR_CREDIT_RATE = 0.80; // HK$ per kWh

// Formatting functions
const formatCurrency = (amount) => {
    if (Math.abs(amount) < 0.001) return "0.00";
    const formatted = parseFloat(amount).toFixed(2);
    return formatted === "-0.00" ? "0.00" : formatted;
};

const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-HK');
};

// Update billing display
function updateBillingDisplay(consumptionAmount, solarAmount) {
    // Update consumption details
    document.getElementById('consumption-amount').textContent = formatCurrency(consumptionAmount);
    const electricityCost = consumptionAmount * ELECTRICITY_RATE;
    document.getElementById('electricity-cost').textContent = formatCurrency(electricityCost);

    // Update solar details
    document.getElementById('solar-amount').textContent = formatCurrency(solarAmount);
    const solarCredit = solarAmount * SOLAR_CREDIT_RATE;
    document.getElementById('solar-credit').textContent = formatCurrency(solarCredit);

    // Calculate total amount
    const totalAmount = electricityCost - solarCredit;
    
    // Handle the display of total amount
    // If the absolute value is very small (effectively zero), display as 0.00
    if (Math.abs(totalAmount) < 0.001) {
        document.getElementById('total-amount').textContent = "0.00";
        document.getElementById('paypal-amount').textContent = "HK$ 0.00";
    } else {
        document.getElementById('total-amount').textContent = formatCurrency(totalAmount);
        document.getElementById('paypal-amount').textContent = `HK$ ${formatCurrency(totalAmount)}`;
    }
}

// Fetch latest readings from Firebase
async function fetchLatestReadings(userId) {
    try {
        // Get latest power usage and charge amount
        const powerUsageRef = db.ref(`users/${userId}/data/Power_Usage_(Wh)`);
        const chargeAmountRef = db.ref(`users/${userId}/data/Charge_Amount_(Wh)`);
        
        // Get the latest readings
        const [powerUsageSnapshot, chargeAmountSnapshot] = await Promise.all([
            powerUsageRef.orderByChild('timestamp').limitToLast(1).once('value'),
            chargeAmountRef.orderByChild('timestamp').limitToLast(1).once('value')
        ]);

        let powerUsageAmount = 0;
        let chargeAmount = 0;

        powerUsageSnapshot.forEach((child) => {
            powerUsageAmount = child.val().value || 0;
        });

        chargeAmountSnapshot.forEach((child) => {
            chargeAmount = child.val().value || 0;
        });

        // Convert Wh to kWh
        //powerUsageAmount = powerUsageAmount / 1000;
        //chargeAmount = chargeAmount / 1000;
        
        // Update the display
        updateBillingDisplay(powerUsageAmount, chargeAmount);
        
        // Calculate costs for return value
        const electricityCost = powerUsageAmount * ELECTRICITY_RATE;
        const solarCredit = chargeAmount * SOLAR_CREDIT_RATE;
        
        return {
            consumption: powerUsageAmount,
            solar: chargeAmount,
            total: electricityCost - solarCredit
        };
    } catch (error) {
        console.error('Error fetching readings:', error);
        alert('Error loading billing data. Please try again later.');
    }
}

// Update payment history
function updatePaymentHistory(userId) {
    const historyRef = db.ref(`users/${userId}/payment_history`);
    historyRef.orderByChild('timestamp').limitToLast(5).on('value', snap => {
        const tbody = document.getElementById('payment-history');
        let html = '';

        if (!snap.exists()) {
            html = '<tr><td colspan="5">No payments found</td></tr>';
        } else {
            const payments = [];
            snap.forEach(child => {
                payments.push({ key: child.key, ...child.val() });
            });
            payments.sort((a, b) => b.timestamp - a.timestamp);

            payments.forEach(payment => {
                html += `
                    <tr>
                        <td>${formatDate(payment.timestamp)}</td>
                        <td>${formatCurrency(payment.consumption)} kWh</td>
                        <td>${formatCurrency(payment.solar)} kWh</td>
                        <td>HK$ ${formatCurrency(payment.amount)}</td>
                        <td>${payment.status}</td>
                    </tr>
                `;
            });
        }

        tbody.innerHTML = html; // Update once after processing all payments
    });
}

// Initialize PayPal button
async function initializePayPal(userId) {
    try {
        const { total } = await fetchLatestReadings(userId);
        const amount = Math.abs(total) < 0.001 ? 0 : total;

        paypal.Buttons({
            style: {
                color: 'gold',
                shape: 'pill',
                label: 'pay',
                height: 40
            },

            createOrder: (data, actions) => {
                if (amount <= 0) {
                    alert('No payment required - credit balance available');
                    return Promise.reject('Zero amount');
                }

                return actions.order.create({
                    purchase_units: [{
                        amount: {
                            value: amount.toFixed(2),
                            currency_code: 'HKD'
                        }
                    }]
                });
            },

            onApprove: (data, actions) => actions.order.capture()
                .then(async details => {
                    // Save payment to Firebase
                    const paymentData = {
                        timestamp: Date.now() / 1000,
                        amount: amount,
                        consumption: (await fetchLatestReadings(userId)).consumption,
                        solar: (await fetchLatestReadings(userId)).solar,
                        status: 'Completed',
                        transaction_id: details.id
                    };

                    await db.ref(`users/${userId}/payment_history`).push().set(paymentData);
                    alert(`Payment of HK$${amount.toFixed(2)} successful!`);
                })
                .catch(err => {
                    console.error('Payment error:', err);
                    alert('Payment failed: ' + err.message);
                }),

            onError: err => {
                console.error('PayPal error:', err);
                alert('Payment system error: ' + err.message);
            }

        }).render('#paypal-button');

    } catch (error) {
        console.error('PayPal init error:', error);
        document.getElementById('paypal-button').innerHTML = 
            '<p class="error">Payment system unavailable. Please try again later.</p>';
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(async user => {
        if (!user) return window.location.href = '../login/PowerLink.html';

        try {
            console.log('Initializing for user:', user.uid);
            await initializePayPal(user.uid);
            updatePaymentHistory(user.uid);
            
            // Refresh data every 5 minutes
            setInterval(async () => {
                await fetchLatestReadings(user.uid);
                document.getElementById('paypal-button').innerHTML = '';
                await initializePayPal(user.uid);
            }, 300000);

        } catch (error) {
            console.error('App init error:', error);
            alert('Application initialization failed. Please refresh.');
        }
    });
});
