document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(async user => {
        if (!user) return window.location.href = '../login/PowerLink.html';
        await initializePayPal(user.uid);
    });
});

const db = firebase.database();
async function initializePayPal(userId) {
    const userNameRef = db.ref(`users/${userId}/Name`);
    const useremialRef = db.ref(`users/${userId}/Email`);
    const userphoneRef = db.ref(`users/${userId}/Phone_number`);
    const userHomeRef = db.ref(`users/${userId}/Home_address`);
    userNameRef.once('value')
        .then((snapshot) => {
            const userName = snapshot.val();
            const welcomeMessage = document.getElementById('welcome-message');
            const fullText = `${userName}, Welcome!`;
            typeText(welcomeMessage, fullText, 50);
            //document.getElementById('welcome-message').textContent = `${userName}, Welcome!`;

        });
        useremialRef.once('value')
        .then((snapshot) => {
            const userName = snapshot.val();
            document.getElementById('Email_address').textContent = `Email: ${userName}`;
        });
        userphoneRef.once('value')
        .then((snapshot) => {
            const userName = snapshot.val();
            document.getElementById('Phone_number').textContent = `Phone Number: ${userName}`;
        });
        userHomeRef.once('value')
        .then((snapshot) => {
            const userName = snapshot.val();
            document.getElementById('Home_address').textContent = `Home Address: ${userName}`;
        });
        };

        async function typeText(element, textToType, delay = 200) {
            element.textContent = ''; // Clear existing content
            for (const char of textToType) {
              element.textContent += char;
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }