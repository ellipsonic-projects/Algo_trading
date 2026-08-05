# Angel One Algorithmic Trading Platform

This repository contains a full-stack Algorithmic Trading application integrated with the **Angel One SmartAPI**.

The application is structured into 3 main directories/services:

1. **`backend`**: Node.js Express server with MongoDB (stores users, user strategies, and mock/live trade execution histories).
2. **`angel-one`**: Python FastAPI microservice (handles direct SmartAPI connection, fetches real-time quotes, checks margins, and executes trades).
3. **`algo-trading`**: Vite + React + TypeScript frontend dashboard (displays strategy performance, active monitoring, and configuration controls).

---

## 🛠️ Prerequisites

Make sure you have the following installed on your machine:
- **Node.js** (v18 or higher recommended)
- **Python** (v3.10 or higher)
- **MongoDB** (running locally on port `27017` or an active MongoDB Atlas URI)

---

## ⚙️ Configuration & Environment Setup

We have pre-created the required `.env` files in each service. You must update them with your API keys and credentials.

### 1. Node.js Backend Configuration (`backend/.env`)
Create or edit `backend/.env` with:
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/algo-trading
JWT_SECRET=super-secret-key-for-jwt-signing-12345
JWT_EXPIRES_IN=90d
JWT_COOKIE_EXPIRES_IN=90
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

### 2. Python FastAPI Configuration (`angel-one/.env`)
Create or edit `angel-one/.env` with your SmartAPI credentials:
```env
APP_ENV=development
APP_PORT=8000
CORS_ORIGINS=http://localhost:5173
ANGEL_API_KEY=YOUR_ANGEL_API_KEY
ANGEL_CLIENT_CODE=YOUR_ANGEL_CLIENT_CODE
ANGEL_TOTP_SECRET=YOUR_ANGEL_TOTP_SECRET
ANGEL_BASE_URL=https://apiconnect.angelone.in
```

### 3. Frontend Configuration (`algo-trading/.env`)
Create or edit `algo-trading/.env` with:
```env
VITE_ANGEL_ONE_API_BASE=http://localhost:8000
VITE_ENABLE_LIVE_TRADING=false
VITE_ANGEL_MPIN=

```

---

## 🚀 How to Run the Project

Follow these steps to launch the entire project:

### Step 1: Start MongoDB
Ensure MongoDB is running locally:
```bash
# Example for Windows Command Prompt if MongoDB is installed as a service:
net start MongoDB
```

### Step 2: Set Up and Run the Node.js Backend (`backend`)
1. Navigate to the `backend` folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Seed the database with the default user and default strategies:
   ```bash
   node scripts/seed.js
   ```
   *Note: This creates a default user with:*
   - **Email:** `mithun@gmail.com`
   - **Password:** `mithun@1234`
4. Start the backend:
   ```bash
   npm run dev
   ```
   The backend server will run on `http://localhost:5000`.

### Step 3: Set Up and Run the Python Backend (`angel-one`)
1. Navigate to the `angel-one` folder.
2. Install requirements:
   ```bash
   pip install -r requirements.txt
   pip install websocket-client
   ```
3. Start the FastAPI server:
   ```bash
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
   The Python microservice will run on `http://localhost:8000`.

### Step 4: Set Up and Run the React Frontend (`algo-trading`)
1. Navigate to the `algo-trading` folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```
   The frontend will run on `http://localhost:5173`. Open this URL in your web browser.

---

## 🧪 Running Tests

### Frontend Tests
To run Vitest unit tests in the frontend:
```bash
cd algo-trading
npm run test
```

### Python backend Tests
To run Pytest tests in the Python microservice:
```bash
cd angel-one
python -m pytest
```
