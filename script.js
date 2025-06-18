document.addEventListener('DOMContentLoaded', () => {

    // --- CONFIGURATION ---
    const FLASK_API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://127.0.0.1:5001/api'
        : '/api';
    // The OVERPASS_API_URL constant is no longer needed here.

    // --- STATE MANAGEMENT ---
    let currentView = 'home';
    let currentPredictionDisease = null;
    let flaskChatId = null;
    let geminiChatId = 'gemini_' + Date.now();
    let map = null;
    let isDarkMode = localStorage.getItem('darkMode') === 'true';

    // --- DOM ELEMENT REFERENCES ---
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const navLinks = document.querySelectorAll('.nav-link');
    const views = document.querySelectorAll('.view');
    const predictionFormContainer = document.getElementById('prediction-form-container');
    const predictFormBtn = document.getElementById('predict-form-btn');
    const predictionResult = document.getElementById('prediction-result');
    
    // Disease Prediction Chat
    const predictChatBtn = document.getElementById('predict-chat-btn');
    const chatPredictionBox = document.getElementById('chat-prediction-box');
    const chatPredictionInputArea = document.getElementById('chat-prediction-input-area');
    const chatQuestionText = document.getElementById('chat-question-text');
    const chatUserInput = document.getElementById('chat-user-input');
    const chatSubmitAnswer = document.getElementById('chat-submit-answer');
    const chatPredictionResult = document.getElementById('chat-prediction-result');

    // Gemini Chat
    const geminiChatHistory = document.getElementById('gemini-chat-history');
    const geminiChatInput = document.getElementById('gemini-chat-input');
    const geminiChatSend = document.getElementById('gemini-chat-send');

    // Hospitals
    const findHospitalsBtn = document.getElementById('find-hospitals-btn');
    const radiusSlider = document.getElementById('radius-slider');
    const radiusValue = document.getElementById('radius-value');
    const hospitalList = document.getElementById('hospital-list');

    // --- DISEASE FIELD DEFINITIONS ---
    const diseaseFields = {
        heart: { name: 'Heart Disease', fields: ['age', 'gender', 'cp', 'trestbps', 'chol', 'fbs', 'restecg', 'thalach', 'exang', 'oldpeak', 'slope', 'ca', 'thal'] },
        diabetes: { name: 'Diabetes', fields: ['Pregnancies', 'Glucose', 'BloodPressure', 'SkinThickness', 'Insulin', 'BMI', 'DiabetesPedigreeFunction', 'Age'] },
        cancer: { name: 'Cnacer', fields: ['fo', 'fhi', 'flo', 'Jitter_percent', 'Jitter_Abs', 'RAP', 'PPQ', 'DDP', 'Shimmer', 'Shimmer_dB', 'APQ3', 'APQ5', 'APQ', 'DDA', 'NHR', 'HNR', 'RPDE', 'DFA', 'spread1', 'spread2', 'D2', 'PPE'] },
        covid: { name: 'COVID-19', fields: ['fever', 'cough', 'breathlessness', 'sore_throat', 'headache', 'fatigue', 'loss_of_smell', 'contact', 'travel_history'] }
    };
    
    // --- INITIALIZATION ---
    function init() {
        // Set initial dark mode
        if (isDarkMode) {
            document.body.setAttribute('data-theme', 'dark');
            darkModeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        }

        // Dark mode toggle
        darkModeToggle.addEventListener('click', () => {
            isDarkMode = !isDarkMode;
            document.body.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
            darkModeToggle.innerHTML = isDarkMode ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            localStorage.setItem('darkMode', isDarkMode);
        });

        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                showView(link.getAttribute('data-view'));
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            });
        });

        predictFormBtn.addEventListener('click', handleFormPrediction);
        predictChatBtn.addEventListener('click', startPredictionChat);
        chatSubmitAnswer.addEventListener('click', sendPredictionAnswer);
        chatUserInput.addEventListener('keypress', (e) => e.key === 'Enter' && sendPredictionAnswer());
        geminiChatSend.addEventListener('click', sendGeminiMessage);
        geminiChatInput.addEventListener('keypress', (e) => e.key === 'Enter' && sendGeminiMessage());
        findHospitalsBtn.addEventListener('click', handleFindHospitals);
        radiusSlider.addEventListener('input', () => radiusValue.textContent = radiusSlider.value);
    }
    
    // --- VIEW MANAGEMENT ---
    function showView(viewId) {
        currentView = viewId;
        
        // First fade out current view
        const currentActiveView = document.querySelector('.active-view');
        if (currentActiveView) {
            currentActiveView.style.opacity = '0';
            currentActiveView.style.transform = 'translateY(20px)';
            setTimeout(() => {
                currentActiveView.classList.remove('active-view');
                
                // Then show new view
                if (diseaseFields[viewId]) {
                    setupPredictionView(viewId);
                    const predictionView = document.getElementById('prediction-view');
                    predictionView.classList.add('active-view');
                    setTimeout(() => {
                        predictionView.style.opacity = '1';
                        predictionView.style.transform = 'translateY(0)';
                    }, 50);
                } else {
                    const newView = document.getElementById(`${viewId}-view`);
                    newView.classList.add('active-view');
                    setTimeout(() => {
                        newView.style.opacity = '1';
                        newView.style.transform = 'translateY(0)';
                    }, 50);
                }
            }, 300);
        } else {
            // If no current view, just show the new one
            if (diseaseFields[viewId]) {
                setupPredictionView(viewId);
                document.getElementById('prediction-view').classList.add('active-view');
            } else {
                document.getElementById(`${viewId}-view`).classList.add('active-view');
            }
        }
    }

    // --- DISEASE PREDICTION ---
    function setupPredictionView(disease) {
        currentPredictionDisease = disease;
        const { name, fields } = diseaseFields[disease];
        
        document.getElementById('prediction-title').textContent = `${name} Prediction`;
        document.getElementById('prediction-description').textContent = `Fill the form below or use the guided chat to predict the risk of ${name}.`;

        predictionFormContainer.innerHTML = '';
        fields.forEach(field => {
            const input = document.createElement('input');
            input.type = 'number';
            input.id = `field-${field}`;
            input.name = field;
            input.placeholder = `Enter value for ${field.replace(/_/g, ' ')}...`;
            input.step = 'any';

            // Add restrictions based on the field
            switch (field) {
                case 'gender':
                    input.min = 1;
                    input.max = 3;
                    input.title = '1 for Male, 2 for Female, 3 for Others';
                    break;
                case 'age':
                case 'Age':
                    input.min = 0;
                    input.max = 100;
                    input.title = 'Age must be between 0 and 100';
                    break;
                case 'cp':
                    input.min = 0;
                    input.max = 3;
                    input.title = 'Chest Pain Type: 0 for None, 1 for Typical Angina, 2 for Atypical Angina, 3 for Non-Anginal Pain';
                    break;
                case 'trestbps':
                    input.min = 90;
                    input.max = 200;
                    input.title = 'Resting Blood Pressure (mm Hg) must be between 90 and 200';
                    break;
                case 'chol':
                    input.min = 100;
                    input.max = 600;
                    input.title = 'Cholesterol (mg/dl) must be between 100 and 600';
                    break;
                case 'fbs':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Fasting Blood Sugar: 0 for <= 120 mg/dl, 1 for > 120 mg/dl';
                    break;
                case 'restecg':
                    input.min = 0;
                    input.max = 2;
                    input.title = 'Resting ECG Results: 0 for Normal, 1 for ST-T Wave Abnormality, 2 for Left Ventricular Hypertrophy';
                    break;
                case 'thalach':
                    input.min = 60;
                    input.max = 202;
                    input.title = 'Maximum Heart Rate Achieved must be between 60 and 202';
                    break;
                case 'exang':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Exercise Induced Angina: 0 for No, 1 for Yes';
                    break;
                case 'oldpeak':
                    input.min = 0;
                    input.max = 6.2;
                    input.title = 'ST Depression Induced by Exercise Relative to Rest must be between 0 and 6.2';
                    break;
                case 'slope':
                    input.min = 0;
                    input.max = 2;
                    input.title = 'Slope of the Peak Exercise ST Segment: 0 for Upsloping, 1 for Flat, 2 for Downsloping';
                    break;
                case 'ca':
                    input.min = 0;
                    input.max = 3;
                    input.title = 'Number of Major Vessels Colored by Fluoroscopy must be between 0 and 3';
                    break;
                case 'thal':
                    input.min = 0;
                    input.max = 3;
                    input.title = 'Thalassemia: 0 for Normal, 1 for Fixed Defect, 2 for Reversible Defect, 3 for Unknown';
                    break;
                case 'Pregnancies':
                    input.min = 0;
                    input.max = 17;
                    input.title = 'Number of Pregnancies must be between 0 and 17';
                    break;
                case 'Glucose':
                    input.min = 0;
                    input.max = 199;
                    input.title = 'Glucose Level (mg/dl) must be between 0 and 199';
                    break;
                case 'BloodPressure':
                    input.min = 0;
                    input.max = 122;
                    input.title = 'Blood Pressure (mm Hg) must be between 0 and 122';
                    break;
                case 'SkinThickness':
                    input.min = 0;
                    input.max = 99;
                    input.title = 'Skin Thickness (mm) must be between 0 and 99';
                    break;
                case 'Insulin':
                    input.min = 0;
                    input.max = 846;
                    input.title = 'Insulin Level (mu U/ml) must be between 0 and 846';
                    break;
                case 'BMI':
                    input.min = 0;
                    input.max = 67.1;
                    input.title = 'Body Mass Index must be between 0 and 67.1';
                    break;
                case 'DiabetesPedigreeFunction':
                    input.min = 0.078;
                    input.max = 2.42;
                    input.title = 'Diabetes Pedigree Function must be between 0.078 and 2.42';
                    break;
                case 'fo':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Frequency of Occurrence must be between 0 and 1';
                    break;
                case 'fhi':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Frequency of High Intensity must be between 0 and 1';
                    break;
                case 'flo':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Frequency of Low Intensity must be between 0 and 1';
                    break;
                case 'Jitter_percent':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Jitter Percent must be between 0 and 1';
                    break;
                case 'Jitter_Abs':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Jitter Absolute must be between 0 and 1';
                    break;
                case 'RAP':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Relative Average Perturbation must be between 0 and 1';
                    break;
                case 'PPQ':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Pitch Perturbation Quotient must be between 0 and 1';
                    break;
                case 'DDP':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Double Degradation of Pitch must be between 0 and 1';
                    break;
                case 'Shimmer':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Shimmer must be between 0 and 1';
                    break;
                case 'Shimmer_dB':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Shimmer in dB must be between 0 and 1';
                    break;
                case 'APQ3':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Amplitude Perturbation Quotient 3 must be between 0 and 1';
                    break;
                case 'APQ5':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Amplitude Perturbation Quotient 5 must be between 0 and 1';
                    break;
                case 'APQ':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Amplitude Perturbation Quotient must be between 0 and 1';
                    break;
                case 'DDA':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Double Degradation of Amplitude must be between 0 and 1';
                    break;
                case 'NHR':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Noise to Harmonics Ratio must be between 0 and 1';
                    break;
                case 'HNR':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Harmonics to Noise Ratio must be between 0 and 1';
                    break;
                case 'RPDE':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Recurrence Period Density Entropy must be between 0 and 1';
                    break;
                case 'DFA':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Detrended Fluctuation Analysis must be between 0 and 1';
                    break;
                case 'spread1':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Spread 1 must be between 0 and 1';
                    break;
                case 'spread2':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Spread 2 must be between 0 and 1';
                    break;
                case 'D2':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'D2 must be between 0 and 1';
                    break;
                case 'PPE':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Pitch Period Entropy must be between 0 and 1';
                    break;
                case 'fever':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Fever: 0 for No, 1 for Yes';
                    break;
                case 'cough':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Cough: 0 for No, 1 for Yes';
                    break;
                case 'breathlessness':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Breathlessness: 0 for No, 1 for Yes';
                    break;
                case 'sore_throat':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Sore Throat: 0 for No, 1 for Yes';
                    break;
                case 'headache':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Headache: 0 for No, 1 for Yes';
                    break;
                case 'fatigue':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Fatigue: 0 for No, 1 for Yes';
                    break;
                case 'loss_of_smell':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Loss of Smell: 0 for No, 1 for Yes';
                    break;
                case 'contact':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Contact with COVID-19 Patient: 0 for No, 1 for Yes';
                    break;
                case 'travel_history':
                    input.min = 0;
                    input.max = 1;
                    input.title = 'Travel History: 0 for No, 1 for Yes';
                    break;
                // Add more cases for other fields as needed
            }

            const label = document.createElement('label');
            label.htmlFor = `field-${field}`;
            label.textContent = field.replace(/_/g, ' ').toUpperCase();

            const rangeLabel = document.createElement('div');
            rangeLabel.className = 'range-label';
            rangeLabel.textContent = input.title;
            rangeLabel.style.color = 'lightblue';

            const inputGroup = document.createElement('div');
            inputGroup.className = 'input-group';
            inputGroup.appendChild(label);
            inputGroup.appendChild(rangeLabel);
            inputGroup.appendChild(input);

            predictionFormContainer.appendChild(inputGroup);
        });

        predictionResult.innerHTML = '';
        predictionResult.className = 'result-box';
        resetPredictionChatUI();
    }

    async function handleFormPrediction() {
        if (!currentPredictionDisease) return;

        predictFormBtn.disabled = true;
        predictFormBtn.textContent = 'Predicting...';
        predictionResult.innerHTML = '';
        predictionResult.className = 'result-box';

        const fields = diseaseFields[currentPredictionDisease].fields;
        const features = [];
        let isValid = true;

        fields.forEach(field => {
            const input = document.getElementById(`field-${field}`);
            if (input.value.trim() === '') isValid = false;
            features.push(parseFloat(input.value));
        });

        if (!isValid) {
            alert('Please fill out all the fields in the form before predicting.');
            predictFormBtn.disabled = false;
            predictFormBtn.textContent = 'Predict from Form';
            return;
        }

        try {
            const response = await fetch(`${FLASK_API_URL}/${currentPredictionDisease}/predict_form`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ features: features })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'An unknown error occurred.');

            predictionResult.innerHTML = data.explanation;
            predictionResult.className = `result-box ${data.isHighRisk ? 'danger' : 'success'}`;

        } catch (error) {
            predictionResult.textContent = `Error: ${error.message}`;
            predictionResult.className = 'result-box error';
        } finally {
            predictFormBtn.disabled = false;
            predictFormBtn.textContent = 'Predict from Form';
        }
    }

    function resetPredictionChatUI() {
        chatPredictionBox.innerHTML = '';
        chatPredictionBox.classList.add('hidden');
        chatPredictionInputArea.classList.add('hidden');
        chatPredictionResult.innerHTML = '';
        chatPredictionResult.className = 'result-box';
        predictChatBtn.disabled = false;
        predictChatBtn.textContent = 'Start Guided Chat Prediction';
    }

    async function startPredictionChat() {
        if (!currentPredictionDisease) return;

        resetPredictionChatUI();
        predictChatBtn.disabled = true;
        predictChatBtn.textContent = 'Chat in Progress...';
        flaskChatId = 'flask_' + Date.now();

        try {
            const response = await fetch(`${FLASK_API_URL}/${currentPredictionDisease}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: flaskChatId })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            
            chatPredictionBox.classList.remove('hidden');
            addMessage(data.message, 'bot', chatPredictionBox);
            displayNextQuestion(data.nextQuestion);

        } catch (error) {
            chatPredictionResult.textContent = `Error: ${error.message}`;
            chatPredictionResult.className = 'result-box error';
            predictChatBtn.disabled = false;
            predictChatBtn.textContent = 'Start Guided Chat Prediction';
        }
    }

    function displayNextQuestion(question) {
        chatPredictionInputArea.classList.remove('hidden');
        addMessage(question.text, 'bot', chatPredictionBox);
        chatUserInput.dataset.questionId = question.id;
        chatUserInput.focus();
    }

    async function sendPredictionAnswer() {
        const answer = chatUserInput.value;
        const questionId = chatUserInput.dataset.questionId;
        if (!answer.trim()) return;

        addMessage(answer, 'user', chatPredictionBox);
        chatUserInput.value = '';
        chatPredictionInputArea.classList.add('hidden');

        try {
            const response = await fetch(`${FLASK_API_URL}/${currentPredictionDisease}/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: flaskChatId, questionId, answer })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            if (data.isComplete) {
                const result = data.prediction;
                chatPredictionResult.innerHTML = `<strong>${data.explanation}</strong>`;
                data.recommendations.forEach(rec => {
                    chatPredictionResult.innerHTML += `<p><b>${rec.title}:</b> ${rec.description}</p>`;
                });
                chatPredictionResult.className = `result-box ${result.isHighRisk ? 'danger' : 'success'}`;
                predictChatBtn.disabled = false;
                predictChatBtn.textContent = 'Start Guided Chat Prediction';
            } else {
                displayNextQuestion(data.nextQuestion);
            }
        } catch (error) {
            chatPredictionResult.textContent = `Error: ${error.message}`;
            chatPredictionResult.className = 'result-box error';
        }
    }
    
    async function sendGeminiMessage() {
        const prompt = geminiChatInput.value.trim();
        if (!prompt) return;

        addMessage(prompt, 'user', geminiChatHistory);
        geminiChatInput.value = '';
        geminiChatSend.disabled = true;
        geminiChatSend.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const response = await fetch(`${FLASK_API_URL}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, chat_id: geminiChatId })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            const formattedResponse = marked.parse(data.response);
            addMessage(formattedResponse, 'bot', geminiChatHistory, true);

        } catch (error) {
            addMessage(`Sorry, I encountered an error: ${error.message}`, 'bot', geminiChatHistory);
        } finally {
            geminiChatSend.disabled = false;
            geminiChatSend.innerHTML = '<i class="fas fa-paper-plane"></i>';
        }
    }
    
    // --- HOSPITAL FINDER (IMPROVED) ---
    async function handleFindHospitals() {
        findHospitalsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Locating you...';
        findHospitalsBtn.disabled = true;
        hospitalList.innerHTML = '';

        navigator.geolocation.getCurrentPosition(async (position) => {
            const { latitude, longitude } = position.coords;
            const radiusKm = parseInt(radiusSlider.value, 10);
            
            findHospitalsBtn.innerHTML = '<i class="fas fa-search-location"></i> Finding hospitals...';

            try {
                const response = await fetch(`${FLASK_API_URL}/hospitals`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ latitude, longitude, radius: radiusKm })
                });

                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error || 'Backend server error');
                }

                const hospitals = await response.json();
                
                if (!map) {
                    initializeMap([latitude, longitude]);
                } else {
                    map.eachLayer(layer => {
                        if (layer instanceof L.Marker) map.removeLayer(layer);
                    });
                    map.setView([latitude, longitude], 13);
                }
                
                L.marker([latitude, longitude], { 
                    icon: L.icon({ 
                        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png', 
                        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', 
                        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
                    }) 
                }).addTo(map).bindPopup('<b>Your Location</b>').openPopup();

                renderHospitalListAndMarkers(hospitals);

            } catch (error) {
                hospitalList.innerHTML = `<p class="error-text">Could not fetch hospitals: ${error.message}</p>`;
            } finally {
                findHospitalsBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Find Hospitals';
                findHospitalsBtn.disabled = false;
            }

        }, (error) => {
            alert(`Geolocation Error: ${error.message}. Please enable location services.`);
            findHospitalsBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Find Hospitals';
            findHospitalsBtn.disabled = false;
        });
    }

    function initializeMap(center) {
        map = L.map('map').setView(center, 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        hospitalList.addEventListener('click', (e) => {
            const card = e.target.closest('.hospital-card');
            if (card && card.dataset.lat) {
                const lat = parseFloat(card.dataset.lat);
                const lon = parseFloat(card.dataset.lon);
                map.flyTo([lat, lon], 16);
                
                map.eachLayer(layer => {
                    if (layer instanceof L.Marker && layer.getLatLng().equals(L.latLng(lat, lon))) {
                        layer.openPopup();
                    }
                });
            }
        });
    }

    function renderHospitalListAndMarkers(hospitals) {
        if (hospitals.length === 0) {
            hospitalList.innerHTML = '<p>No hospitals or clinics found in the selected radius. Try increasing it.</p>';
            return;
        }

        hospitalList.innerHTML = `<h3>Found ${hospitals.length} facilities:</h3>`;
        hospitals.forEach(h => {
            L.marker([h.lat, h.lon]).addTo(map)
                .bindPopup(`<b>${h.name}</b><br>${h.address}`);

            const card = `
                <div class="hospital-card" data-lat="${h.lat}" data-lon="${h.lon}" role="button" tabindex="0">
                    <h4>${h.name} <span class="distance">${h.distance_km} km</span></h4>
                    <p><i class="fas fa-map-pin"></i> ${h.address}</p>
                    <p><i class="fas fa-tag"></i> Type: ${h.type}</p>
                </div>`;
            hospitalList.innerHTML += card;
        });
    }

    // --- UTILITY FUNCTIONS ---
    function addMessage(content, sender, container, isHTML = false) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);
        if (isHTML) {
            messageElement.innerHTML = content;
        } else {
            messageElement.textContent = content;
        }
        container.appendChild(messageElement);
        container.scrollTop = container.scrollHeight;
    }

    // --- START THE APP ---
    init();
});