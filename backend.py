from flask import Flask, request, jsonify
import pickle
import numpy as np
from flask_cors import CORS
import os
import google.generativeai as genai
import requests
from geopy.distance import geodesic

### NEW IMPORTS for the Hospital Finder feature ###


# --- INITIAL SETUP ---
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)  # Enable CORS for all routes and all origins

# --- GEMINI AI CHAT SETUP ---
# It's best practice to set this as an environment variable in your OS.
# For simplicity in this example, we set it here.
# IMPORTANT: Replace with your actual Google AI Studio API Key.
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY', "AIzaSyAPrO5G4SUuY37_LCOlFW-bFwANfK6RFVI")
try:
    genai.configure(api_key=GOOGLE_API_KEY)
    gemini_model = genai.GenerativeModel('gemini-1.5-flash-latest')
    gemini_chat_sessions = {} # Store different chat sessions by chat_id
    print("Gemini AI model configured successfully.")
except Exception as e:
    print(f"Error configuring Gemini AI: {e}. The chat assistant will not work.")
    gemini_model = None


# --- LOAD ML MODELS ---
try:
    model_path = os.path.join(os.path.dirname(__file__), 'heart_model.sav')
    hdmodel = pickle.load(open(model_path, 'rb'))
    diabetes_model_path = os.path.join(os.path.dirname(__file__), 'diabetes_model.sav')
    diabetesmodel = pickle.load(open(diabetes_model_path, 'rb'))
    cancer_model_path = os.path.join(os.path.dirname(__file__), 'cancer_model.sav')
    cancersmodel = pickle.load(open(cancer_model_path, 'rb'))
    covid_model_path = os.path.join(os.path.dirname(__file__), 'covid_model (1).sav')
    covidmodel = pickle.load(open(covid_model_path, 'rb'))
    print("All prediction models loaded successfully.")
except FileNotFoundError as e:
    print(f"Error loading models: {e}. Make sure all .sav files are in the same directory.")
    exit() # Exit if models can't be loaded


# --- STATE MANAGEMENT FOR CONVERSATIONAL PREDICTION ---
chat_states = {}

# --- DISEASE FIELD DEFINITIONS ---
DISEASE_FIELDS = {
    'heart': ['age', 'gender', 'cp', 'trestbps', 'chol', 'fbs', 'restecg', 'thalach', 'exang', 'oldpeak', 'slope', 'ca', 'thal'],
    'diabetes': ['Pregnancies', 'Glucose', 'BloodPressure', 'SkinThickness', 'Insulin', 'BMI', 'DiabetesPedigreeFunction', 'Age'],
    'cancer': ['fo', 'fhi', 'flo', 'Jitter_percent', 'Jitter_Abs', 'RAP', 'PPQ', 'DDP', 'Shimmer', 'Shimmer_dB', 'APQ3', 'APQ5', 'APQ', 'DDA', 'NHR', 'HNR', 'RPDE', 'DFA', 'spread1', 'spread2', 'D2', 'PPE'],
    'covid': ['fever', 'cough', 'breathlessness', 'sore_throat', 'headache', 'fatigue', 'loss_of_smell', 'contact', 'travel_history']
}

### NEW SECTION: HOSPITAL FINDER HELPER FUNCTIONS ###

def find_hospitals_osm(latitude, longitude, radius_km):
    """Finds hospitals using the Overpass API (OpenStreetMap data)."""
    radius_meters = int(radius_km * 1000)
    query = f"""
    [out:json][timeout:25];
    (
      node["amenity"~"hospital|clinic"](around:{radius_meters},{latitude},{longitude});
      way["amenity"~"hospital|clinic"](around:{radius_meters},{latitude},{longitude});
      relation["amenity"~"hospital|clinic"](around:{radius_meters},{latitude},{longitude});
    );
    out center;
    """
    try:
        response = requests.post("https://overpass-api.de/api/interpreter", data={'data': query})
        response.raise_for_status()  # Raise an exception for bad status codes
        data = response.json()
        hospitals = []
        for element in data.get('elements', []):
            if element.get('tags'):
                lat = element.get('lat') or element.get('center', {}).get('lat')
                lon = element.get('lon') or element.get('center', {}).get('lon')
                if lat and lon:
                    hospitals.append({
                        'name': element['tags'].get('name', 'Unnamed Facility'),
                        'type': element['tags'].get('amenity', 'N/A'),
                        'lat': lat,
                        'lon': lon,
                        'address': element['tags'].get('addr:full', 'Address not available'),
                        'source': 'OpenStreetMap'
                    })
        return hospitals
    except requests.RequestException as e:
        print(f"Overpass API request failed: {e}")
        return []

def find_hospitals_photon(latitude, longitude, radius_km):
    """Finds hospitals using the Photon API."""
    try:
        url = f"https://photon.komoot.io/api/?q=hospital&lat={latitude}&lon={longitude}&limit=50&radius={radius_km}"
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        hospitals = []
        for feature in data.get('features', []):
            props = feature.get('properties', {})
            if props.get('osm_value') in ['hospital', 'clinic', 'doctors']:
                hospitals.append({
                    'name': props.get('name', 'Unnamed Facility'),
                    'type': props.get('osm_value', 'N/A'),
                    'lat': feature['geometry']['coordinates'][1],
                    'lon': feature['geometry']['coordinates'][0],
                    'address': f"{props.get('street', '')}, {props.get('city', '')}".strip(', '),
                    'source': 'Photon'
                })
        return hospitals
    except requests.RequestException as e:
        print(f"Photon API request failed: {e}")
        return []

def merge_and_sort_hospitals(user_lat, user_lon, hospital_lists):
    """Merges, deduplicates, calculates distance, and sorts hospitals."""
    merged = {}
    for hospital_list in hospital_lists:
        for hospital in hospital_list:
            key = f"{hospital['name']}_{round(hospital['lat'], 4)}_{round(hospital['lon'], 4)}"
            if key not in merged:
                hospital['distance_km'] = round(geodesic((user_lat, user_lon), (hospital['lat'], hospital['lon'])).kilometers, 2)
                merged[key] = hospital

    sorted_hospitals = sorted(merged.values(), key=lambda x: x['distance_km'])
    return sorted_hospitals


# === API ROUTES ===

# 1. GENERAL PURPOSE AI CHATBOT (GEMINI PROXY)
@app.route('/api/chat', methods=['POST'])
def general_chat():
    if not gemini_model:
        return jsonify({'error': 'AI assistant is not configured on the server.'}), 503

    data = request.json
    prompt = data.get('prompt')
    chat_id = data.get('chat_id', 'default_gemini')

    if not prompt:
        return jsonify({'error': 'Prompt is missing'}), 400

    try:
        if chat_id not in gemini_chat_sessions:
            gemini_chat_sessions[chat_id] = gemini_model.start_chat(history=[])
        
        chat_session = gemini_chat_sessions[chat_id]
        response = chat_session.send_message(prompt, stream=False)
        
        return jsonify({'response': response.text})

    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        return jsonify({'error': 'Failed to get response from AI assistant.'}), 500


# 2. CONVERSATIONAL PREDICTION ENDPOINTS
@app.route('/api/<disease>/start', methods=['POST'])
def start_chat(disease):
    if disease not in DISEASE_FIELDS:
        return jsonify({'error': 'Invalid disease type'}), 400

    chat_id = request.json.get('chat_id', 'default_chat')
    chat_states[chat_id] = {
        'disease': disease,
        'current_field': 0,
        'answers': {}
    }
    
    fields = DISEASE_FIELDS[disease]
    
    return jsonify({
        'message': f'Starting {disease} risk assessment chat.',
        'nextQuestion': {
            'id': fields[0],
            'text': f'Please enter the value for {fields[0]}:'
        }
    })


@app.route('/api/<disease>/answer', methods=['POST'])
def process_answer(disease):
    if disease not in DISEASE_FIELDS:
        return jsonify({'error': 'Invalid disease type'}), 400

    chat_id = request.json.get('chat_id', 'default_chat')
    if chat_id not in chat_states:
        return jsonify({'error': 'Chat session not found or expired.'}), 404

    state = chat_states[chat_id]
    question_id = request.json.get('questionId')
    answer = request.json.get('answer')

    if not question_id or answer is None:
        return jsonify({'error': 'Missing question ID or answer'}), 400

    try:
        state['answers'][question_id] = float(answer)
    except ValueError:
        return jsonify({'error': f'Invalid number format for answer: {answer}'}), 400
        
    state['current_field'] += 1
    fields = DISEASE_FIELDS[disease]

    if state['current_field'] >= len(fields):
        features = [state['answers'].get(field, 0) for field in fields]
        features_array = np.array(features, dtype=float).reshape(1, -1)
        
        prediction = None
        if disease == 'heart':
            prediction = hdmodel.predict(features_array)
        elif disease == 'diabetes':
            prediction = diabetesmodel.predict(features_array)
        elif disease == 'cancer':
            prediction = cancersmodel.predict(features_array)
        elif disease == 'covid':
            prediction = covidmodel.predict(features_array)
        
        del chat_states[chat_id]
        is_high_risk = bool(prediction[0])

        return jsonify({
            'isComplete': True,
            'prediction': { 'isHighRisk': is_high_risk },
            'explanation': f'Based on your inputs, there is a {"high" if is_high_risk else "low"} risk of {disease}.',
            'recommendations': [
                {'title': 'Consult a Doctor', 'description': 'This is not a medical diagnosis. Please consult a healthcare professional.'},
                {'title': 'Learn More', 'description': 'Research ways to manage your risk factors and maintain a healthy lifestyle.'}
            ]
        })
    else:
        next_field = fields[state['current_field']]
        return jsonify({
            'isComplete': False,
            'nextQuestion': { 'id': next_field, 'text': f'Please enter the value for {next_field}:' }
        })


# 3. DIRECT FORM-BASED PREDICTION ENDPOINT
@app.route('/api/<disease>/predict_form', methods=['POST'])
def predict_from_form(disease):
    if disease not in DISEASE_FIELDS:
        return jsonify({'error': 'Invalid disease type'}), 400

    data = request.json
    features = data.get('features')

    if not features or not isinstance(features, list) or len(features) != len(DISEASE_FIELDS[disease]):
        return jsonify({'error': f'Invalid or incomplete features list. Expected {len(DISEASE_FIELDS[disease])} values.'}), 400

    try:
        features_array = np.array(features, dtype=float).reshape(1, -1)
        
        prediction = None
        if disease == 'heart':
            prediction = hdmodel.predict(features_array)
        elif disease == 'diabetes':
            prediction = diabetesmodel.predict(features_array)
        elif disease == 'cancer':
            prediction = cancersmodel.predict(features_array)
        elif disease == 'covid':
            prediction = covidmodel.predict(features_array)

        is_high_risk = bool(prediction[0])
        
        return jsonify({
            'isHighRisk': is_high_risk,
            'explanation': f'Based on the provided data, there is a {"high" if is_high_risk else "low"} risk of {disease}.'
        })

    except Exception as e:
        return jsonify({'error': f'Prediction failed: {str(e)}'}), 500


### NEW ROUTE: NEARBY HOSPITAL FINDER ###
@app.route('/api/hospitals', methods=['POST'])
def get_nearby_hospitals():
    """Endpoint to find nearby hospitals."""
    data = request.json
    lat = data.get('latitude')
    lon = data.get('longitude')
    radius = data.get('radius', 5)

    if not lat or not lon:
        return jsonify({'error': 'Latitude and Longitude are required.'}), 400

    osm_hospitals = find_hospitals_osm(lat, lon, radius)
    photon_hospitals = find_hospitals_photon(lat, lon, radius)
    
    final_hospitals = merge_and_sort_hospitals(lat, lon, [osm_hospitals, photon_hospitals])
    
    return jsonify(final_hospitals)


# Add a route to serve the frontend
@app.route('/')
def serve_frontend():
    return app.send_static_file('index.html')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port)