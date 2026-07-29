# OptionAlgo - Angel One Algorithmic & Manual Trading Platform
## Product Requirements Document (PRD)

---

### **Document Control**

| Attribute | Details |
| :--- | :--- |
| **Project Name** | OptionAlgo - Institutional Algorithmic & Manual Options Terminal |
| **Document Title** | Comprehensive Product Requirements Document (PRD) |
| **Version** | 2.0.0 (Production & Next-Gen Architecture Release) |
| **Document Status** | Approved / Production Specification |
| **Target Audience** | Senior Product Management, Quantitative Trading Desk, UI/UX Engineering, System Architects |
| **Release Date** | July 2026 |

---

## 1. Table of Contents

1. [Document Control](#document-control)
2. [Executive Summary](#2-executive-summary)
3. [Product Vision & Core Capabilities](#3-product-vision--core-capabilities)
4. [User Roles & Access Control](#4-user-roles--access-control)
5. [Page-by-Page System Specifications & Interface Requirements](#5-page-by-page-system-specifications--interface-requirements)
   - 5.1 Global Navigation & System Header
   - 5.2 Executive System Dashboard Page
   - 5.3 Trades & Audit History Terminal
   - 5.4 Manual Order Execution Terminal Page
   - 5.5 Heiken Ashi Strategy Controller Page
   - 5.6 Modified Heiken Ashi Strategy Controller Page
   - 5.7 5-Minute Premium Range Breakout Strategy Page
   - 5.8 Ichimoku Cloud Strategy Controller Page
   - 5.9 VWAP & SMMA Institutional Strategy Page
   - 5.10 Zero-Hero Expiry Strategy Controller Page
6. [Existing Algorithmic Trading Strategies](#6-existing-algorithmic-trading-strategies)
   - 6.1 5-Minute Premium Range Breakout Strategy
   - 6.2 Heiken Ashi Trend Following Strategy
   - 6.3 Modified Heiken Ashi Trend Strategy
7. [Next-Generation Feature Module Specifications](#7-next-generation-feature-module-specifications)
   - 7.1 Module A: Draw-to-Trade Automation Engine
   - 7.2 Module B: Automated Pattern Recognition Library
   - 7.3 Module C: Visual Multi-Strategy Canvas Builder
   - 7.4 Module D: Natural Language AI Trading Assistant
8. [Strategy Execution Engine & Lifecycle State Machine](#8-strategy-execution-engine--lifecycle-state-machine)
9. [Market Data Infrastructure & Order Execution Pipeline](#9-market-data-infrastructure--order-execution-pipeline)
10. [Risk Management Framework & Capital Preservation](#10-risk-management-framework--capital-preservation)
11. [API Architecture & Interface Overview](#11-api-architecture--interface-overview)
12. [Database Architecture & Persistence Models](#12-database-architecture--persistence-models)
13. [Security, Encryption & Broker Compliance](#13-security-encryption--broker-compliance)
14. [Non-Functional System Requirements](#14-non-functional-system-requirements)
15. [Comprehensive Trading & Financial Glossary](#15-comprehensive-trading--financial-glossary)

---

## 2. Executive Summary

### 2.1 Problem Statement
Modern options trading demands instant execution, real-time visual clarity, strict risk management, and algorithmic precision. Manual options execution on legacy broker portals suffers from high execution latency, manual strike selection delays, emotional reluctance to execute stop losses, and fragmented charting tools. Traders lose significant edge when forced to calculate At-The-Money (ATM) or In-The-Money (ITM) options manually while monitoring spot index movements across disconnected browser tabs.

### 2.2 Solution Overview
**OptionAlgo** resolves these operational bottlenecks by unifying live broker market feeds, automated quantitative strategy execution engines, interactive execution charts, and strict risk controllers into a clean single-page web terminal. Built on a microservices architecture connecting a Node.js strategy engine, a Python FastAPI broker gateway, and a React TypeScript interface, OptionAlgo automates the full options lifecycle—from dynamic strike selection to sub-second entry and exit execution.

### 2.3 Business & Product Value
- **Zero Slippage Execution**: Automated entry and exit triggers execute instantly upon signal generation, eliminating human delay.
- **Enforced Capital Protection**: Automated trailing stop-loss rules and hard profit targets prevent emotional overtrading and mitigate drawdowns.
- **Complete Visual Audit**: Real-time canvas charts render exact BUY and SELL entry markers, prices, and trade P&L overlays directly on the candle chart.
- **Extensible Architecture**: Modular strategy controllers allow effortless expansion into pattern recognition, visual canvas strategy creation, and natural language trading.

---

## 3. Product Vision & Core Capabilities

OptionAlgo delivers an institutional-grade trading workspace designed around six core pillars:

1. **Live Index Ticker Feed**: Real-time tracking of major Indian stock indices (NIFTY 50, SENSEX, BANKNIFTY, FINNIFTY).
2. **Interactive Visual Execution Terminal**: Lightweight charting displaying real-time execution markers (`BUY @ Price`, `SELL @ Price`, P&L results), technical indicators, and historical date lookup.
3. **Automated Algorithmic Execution**: Strategy engines running trend-following (Heiken Ashi, JMA, EMA) and momentum breakout (5-Minute Range Breakout) algorithms.
4. **Dynamic Option Strike Resolver**: Automated selection of ATM, ITM, and OTM option contracts based on live index spot prices.
5. **Manual Fast Order Terminal**: Single-click order placement interface for manual options and equity trades.
6. **Audit & Trade History**: Comprehensive audit trails with time-of-day filtering (IST timezone), exit reason tagging, and performance statistics.

---

## 4. User Roles & Access Control

| Role Name | Scope of Access | Permissions & Security Controls |
| :--- | :--- | :--- |
| **Authenticated Trader (Admin)** | Full Application Access | Access to all system pages, strategy configuration panels, start/stop strategy execution controls, manual trading terminal, broker connection management, trade history audit, and real-time execution logs. |
| **Unauthenticated User** | Login Interface Only | Restricted to the public Authentication interface. All background API endpoints reject unauthenticated requests with HTTP security responses. |

---

## 5. Page-by-Page System Specifications & Interface Requirements

### 5.1 Global Navigation & System Header

#### Interface Elements & Features
- **Brand Identity Header**: Displays logo and platform title (`OptionAlgo - Angel Algo Terminal`).
- **Live Feed Status Indicator**: Green badge reflecting live market data connection.
- **Broker Connection Status Button**: Shows active broker link status (e.g., `Angel One Connected`). Clicking invokes the broker session login modal.
- **Top Quick Tools**: Quick toggle buttons for Theme (Dark/Light), Notifications, System Settings, and User Account Profile menu.
- **Sidebar Navigation Menu**: Left collapsible menu providing navigation across **Dashboard**, **Trades**, and **Strategies** sub-items (**Manual Trading**, **Heikenashi**, **Mod Heikenashi**, **5-Min Breakout**, **Ichimoku**, **VWAP SMMA**, **Expiry Strategy**).
- **Engine Status Footer**: Bottom left indicator displaying backend engine state (`Engine Active`, system version `v1.0.0`).

---

### 5.2 Executive System Dashboard Page

#### Current Page Feature Specifications
- **Live Market Index Ticker Bar**: Four top cards displaying real-time index prices and daily point/percentage changes:
  1. **NIFTY 50 (NSE)**: Live spot price (e.g., `23,995.95`), change value (e.g., `+228.50 [+0.96%]`), and live status pill.
  2. **SENSEX (BSE)**: Live spot price (e.g., `76,835.78`), change value (e.g., `+776.01 [+1.02%]`), and live status pill. Selectable card that updates the main execution chart underneath.
  3. **BANKNIFTY (NSE)**: Live spot price (e.g., `57,087.20`), change value (e.g., `+393.70 [+0.69%]`), and live status pill.
  4. **FINNIFTY (NSE)**: Live spot price (e.g., `26,126.15`), change value (e.g., `+216.25 [+0.83%]`), and live status pill.
- **Chart Control Header Bar**:
  - **Selected Instrument Label**: Displays active chart target (e.g., `SENSEX REAL-TIME EXECUTION CHART - Institutional Data Feed & Signal Overlays`).
  - **Timeframe Selector Buttons**: Instant switching between `1m`, `5m`, `15m`, and `1h` candlestick resolutions.
  - **Historical Date Picker Calendar**: Interactive date input allowing traders to load and audit previous trading day charts and execution markers.
  - **Fast Order Terminal Button**: Launches a quick order entry popup for direct spot and option trading.
  - **Indicators & Overlays Button**: Opens a modal to toggle technical indicators (EMA, JMA, VWAP, Support/Resistance).
- **Real-Time Interactive Execution Chart**:
  - Canvas candlestick rendering displaying real-time price action.
  - Technical indicator overlays (JMA purple line, EMA blue line).
  - **Execution Overlay Markers**: Visual arrows directly on candles showing trade entries and exits with price tags:
    - Green UP Arrow: `BUY @ ₹414.30 (SENSEX26JUL76800CE)`
    - Red DOWN Arrow: `SELL @ ₹414.30 (PnL: +₹0.00)`
    - Profit Realization Tag: `SELL @ ₹485.50 (PnL: +₹1038.00)`
- **Chart Legend & Contract Entry Price Overlay**: Bottom right table pinning entry price references for active contracts (e.g., `Entry (SENSEX26JUL76700CE): 451.21`).

#### Product Manager Recommendations & Page Enhancements
1. **Multi-Chart Grid Layout**: Allow users to split the dashboard into 2x2 or 1x2 grid views to monitor NIFTY and BANKNIFTY simultaneously.
2. **Account Margin & Heatmap Summary Widget**: Add a compact margin utilization widget next to index cards showing available cash, collateral, and daily risk utilization percentage.
3. **One-Click Position Square-Off**: Add an emergency **Square-Off All** red button on the chart header bar to immediately liquidate all open positions in panic market events.

---

### 5.3 Trades & Audit History Terminal

#### Current Page Feature Specifications
- **Performance Summary Header**: Stat cards displaying **Total Realized P&L** (color-coded green/red), **Total Trades Executed**, and **Overall Win Rate Percentage**.
- **Search & Multi-Filter Bar**:
  - **Search Input**: Full-text search for index names or option contract symbols.
  - **Strategy Filter Dropdown**: Filter trades by specific strategy instance.
  - **Date Range Selector**: Pick Start Date and End Date boundaries.
  - **Time-of-Day IST Range Filter**: HH:mm inputs to isolate morning vs. afternoon trading session performance.
  - **Exit Reason Filter**: Categorize trades by `'Target'`, `'SL'`, `'Trailing SL'`, or `'Strategy Reversal'`.
- **Trade History Audit Table**: Columns for Trade ID, Timestamp (IST), Strategy Name, Underlying Index, Option Symbol, Quantity, Buy Price, Exit Price, Realized P&L, and Exit Reason Badge.
- **Pagination Controls**: Page size selector and page navigation buttons.

#### Product Manager Recommendations & Page Enhancements
1. **Trade Export to CSV/Excel**: Add a single-click export button for tax audit and quantitative analytics.
2. **Interactive P&L Calendar Curve**: Include a visual monthly calendar heatmap displaying daily net profit/loss totals.
3. **Trade Replay Modal**: Clicking any trade row opens a pop-up chart replaying the exact candle sequence during which the trade entered and exited.

---

### 5.4 Manual Order Execution Terminal Page

#### Current Page Feature Specifications
- **Watchlist Panel**: Real-time spot price monitoring cards for major indices.
- **Broker Margin Overview Widget**: Displays Net Margin, Available Cash Margin, and Utilized Debits fetched live from Angel One.
- **Order Placement Form Modal**:
  - Exchange Selector (`NSE`, `NFO`, `BSE`, `BFO`, `MCX`).
  - Symbol & Token Input with auto-complete lookup.
  - Transaction Type Toggle (`BUY` / `SELL`).
  - Product Type Selector (`INTRADAY`, `CARRYFORWARD`).
  - Order Type Selector (`MARKET`, `LIMIT`, `SL`, `SL-L`).
  - Quantity Input with automatic lot size validation.
  - Price & Trigger Price Inputs.
- **Active Order Book & Positions Table**: Real-time list of pending broker orders and active positions with manual exit buttons.

#### Product Manager Recommendations & Page Enhancements
1. **Option Chain Selector Grid**: Integrate an interactive Option Chain matrix displaying strike prices, Call/Put implied volatility, and Open Interest (OI) with one-click BUY buttons.
2. **Order Basket Execution**: Allow traders to group multiple option legs (e.g., Straddles, Strangles, Spreads) into a single basket for simultaneous execution.

---

### 5.5 Heiken Ashi Strategy Controller Page

#### Current Page Feature Specifications
- **Algo Controller Header**:
  - **State Badge**: Displays current state (`STOPPED`, `SCANNING`, `IN_TRADE`).
  - **HA Trend Indicator**: Real-time trend classification (`BULLISH`, `BEARISH`, `NEUTRAL`).
  - **Start/Stop Action Button**: Green **Start Strategy** button to launch background engine execution.
- **Strategy Configuration Panel**:
  - **Underlying Instrument Dropdown**: Select target index (e.g., `BANKNIFTY (NSE)`, `NIFTY (NSE)`, `SENSEX (BSE)`).
  - **Primary Timeframe Dropdown**: Base candle interval (`1m`, `5m`, `15m`).
  - **Order Quantity Input**: Contracts/lots to execute (e.g., `30`).
  - **Higher Timeframe Sync Checkbox**: Enables dual-candle confirmation on higher timeframes.
  - **Real Market Execution Consent Checkbox**: Explicit consent flag transmitting live orders to broker API.
- **Risk & Strike Parameters Panel**:
  - **Strike Preference Selector**: Segmented control toggle (`ITM`, `ATM`, `OTM`).
  - **Option Premium Filter**: Min and Max premium price boundaries (e.g., `300` to `400`).
  - **Exit Condition Logic Radio Options**: Toggle between `2 Reversal HA Red Candles` vs. `Fixed Target & SL Points`.
  - **Target Points Input**: Desired profit target in option premium points (e.g., `20`).
  - **Stop Loss Points Input**: Hard stop loss limit in option premium points (e.g., `30`).
- **Engine Health Checkpoints & Monitored Options Panel**:
  - **Monitored CE Option Card**: Real-time token and symbol display for active Call contract.
  - **Monitored PE Option Card**: Real-time token and symbol display for active Put contract.
  - **Status Pointers**: Live status badges for `Broker Connection`, `Next Expiry Locked`, `HA Trend Stability`, `ATM Strike Sync`, and `Premium Discovery`.

#### Product Manager Recommendations & Page Enhancements
1. **Dynamic Risk-Reward Ratio Calculator**: Display live Risk-Reward ratio (e.g., `1:1.5`) dynamically updating as target/SL inputs change.
2. **Max Drawdown Daily Cap**: Allow traders to set a maximum daily loss cap (e.g., ₹5,000) that automatically stops the strategy if reached.

---

### 5.6 Modified Heiken Ashi Strategy Controller Page

#### Current Page Feature Specifications
- **Enhanced Trend Smoothing Panel**: Advanced Jurik Moving Average (JMA) phase and length controls.
- **Strict Wick Sensitivity Controls**: Toggle to enforce double zero-bottom-wick criteria on entry candles.
- **Multi-Timeframe Trend Matrix**: Visual status indicators confirming trend alignment across 1m, 5m, and 15m timeframes.
- **Live Strategy Log Terminal**: Rolling log window outputting second-by-second engine calculations.

#### Product Manager Recommendations & Page Enhancements
1. **Adaptive Moving Average Mode**: Option to dynamically adjust JMA length based on market volatility (ATR).

---

### 5.7 5-Minute Premium Range Breakout Strategy Page

#### Current Page Feature Specifications
- **Breakout Parameter Configuration**:
  - **Mother Candle Range Limit**: Input defining maximum allowable point size for range mother candles (default `30 points`).
  - **Inside Candle Count**: Number of consolidation candles required inside range (default `4 candles`).
  - **Breakout Rule Selector**: Choose `Close Above High` vs. `Wick High Touch`.
- **Automated Target & SL Engine**:
  - Auto-calculates `Stop Loss = Range Low - 2 points`.
  - Auto-calculates `Target = Entry + Risk Points` with minimum risk point validation (`>= 10 points`).
- **Live Range Visualizer Card**: Real-time status displaying active mother candle High, Low, Size, and Breakout state.

#### Product Manager Recommendations & Page Enhancements
1. **False Breakout Filter (Volume Multiplier)**: Require breakout candles to have 1.5x average volume before triggering entry.

---

### 5.8 Ichimoku Cloud Strategy Controller Page

#### Current Page Feature Specifications
- **Indicator Parameters**: Tenkan-sen, Kijun-sen, Senkou Span A/B, and Chikou Span period settings.
- **Cloud Breakout Trigger Rules**: Entry on price crossing Cloud boundaries.

#### Product Manager Recommendations & Page Enhancements
1. **Multi-Timeframe Cloud Confluence**: Require both 5m and 15m clouds to agree on trend direction before placing orders.

---

### 5.9 VWAP & SMMA Institutional Strategy Page

#### Current Page Feature Specifications
- **Institutional Volume Bands**: Anchored VWAP standard deviation upper/lower bands.
- **Smooth Moving Average (SMMA) Filters**: Long-term trend direction filter.

#### Product Manager Recommendations & Page Enhancements
1. **Volume Spike Detection**: Alert and enter when institutional volume surges 300% above moving average volume.

---

### 5.10 Zero-Hero Expiry Strategy Controller Page

#### Current Page Feature Specifications
- **Expiry Gamma Scanner**: Scans low-premium out-of-the-money options (₹10 to ₹30) on index expiry days.
- **Decay Time Window**: Restricts strategy execution strictly to afternoon session (12:30 PM to 03:00 PM IST).

#### Product Manager Recommendations & Page Enhancements
1. **Automated Profit Laddering**: Partial profit booking at 100%, 200%, and 300% premium gain levels.

---

## 6. Existing Algorithmic Trading Strategies

### 6.1 5-Minute Premium Range Breakout Strategy

#### Objective & Market Suitability
Designed for index option buying during consolidation phases. Captures explosive premium expansion following tight 5-minute range compressions.

#### Quantitative Entry Logic
1. Evaluates 5-minute candles of Call (CE) and Put (PE) option contracts.
2. Identifies a 5-candle consolidation structure (1 Mother Candle + 4 Inside Candles).
3. **Mother Range Validation**: `Mother_High - Mother_Low <= 30 points`.
4. **Inside Candle Validation**: All 4 subsequent candles must open and close within `[Mother_Low, Mother_High]`.
5. **Trigger**: Latest completed candle close `> Mother_High` triggers immediate **BUY MARKET** order.

#### Quantitative Exit & Risk Controls
- **Stop Loss**: `Range_Low - 2 points`.
- **Target**: `Entry_Price + Risk_Points` (where `Risk_Points = Entry_Price - Stop_Loss`).
- **Validation Guard**: Requires `Risk_Points >= 10 points` to execute.

---

### 6.2 Heiken Ashi Trend Following Strategy

#### Objective & Market Suitability
Smooths out intra-day noise using Heiken Ashi candles combined with Exponential Moving Average (EMA 20) and Jurik Moving Average (JMA 7).

#### Quantitative Entry Logic
1. Transforms raw OHLC candles to Heiken Ashi candles.
2. Computes EMA 20 and JMA 7 on HA Close prices.
3. **Bullish Entry Criteria**:
   - Last 2 closed HA candles have zero bottom wicks (`|Open - Low| <= 0.05`).
   - Last 2 closed HA candles are green (`Close > Open`).
   - `JMA 7 > EMA 20`.
   - `HA_Close > JMA 7`.

#### Quantitative Exit & Risk Controls
- **Exit Signal**: Appearance of 2 consecutive red HA candles (`Close < Open`), OR breach of active Trailing Stop Loss / Target Points.

---

### 6.3 Modified Heiken Ashi Trend Strategy

#### Objective & Market Suitability
Provides enhanced trend responsiveness with custom JMA phase tuning to capture aggressive momentum moves in high-volatility environments.

---

## 7. Next-Generation Feature Module Specifications

This section details four upcoming production modules designed to expand the platform's capabilities.

### 7.1 Module A: Draw-to-Trade Automation Engine

#### Purpose & Core Vision
Allows traders to draw technical structures (trendlines, breakout boxes, support/resistance lines, supply zones) directly on the interactive price chart and attach automated order execution triggers to those visual drawings.

#### Detailed Feature Specifications & Interface Workflow
1. **Interactive Canvas Drawing Toolbar**: Floating toolbar on the chart with tools for **Trendline**, **Horizontal Breakout Level**, **Rectangle Zone**, and **Parallel Channel**.
2. **Right-Click Drawing Context Menu**: Right-clicking any drawn line opens a **Attach Trade Order** modal.
3. **Order Attach Configuration**:
   - **Trigger Condition**: Touch, Candle Close Above, Candle Close Below.
   - **Action**: Buy Call (CE), Buy Put (PE), Square-Off Position.
   - **Strike Mode**: Dynamic ATM, ITM (+1 to +3 steps).
   - **Attached Visual SL/TP Lines**: Drag-and-drop horizontal dashed lines representing Stop Loss and Target Profit that can be adjusted visually on the chart.
4. **Execution Engine Integration**: The frontend transmits line coordinates and price values to the backend server, which monitors tick prices and executes orders automatically when price crosses drawn boundaries.

---

### 7.2 Module B: Automated Pattern Recognition Library

#### Purpose & Core Vision
An automated computer vision and algorithmic pattern engine that scans live index and option price charts, identifies classical chart patterns in real-time, highlights them visually on the chart, and generates automated execution signals.

#### Pattern Library Specifications
- **Reversal Patterns**: Double Bottom / Double Top, Head & Shoulders / Inverse Head & Shoulders, Triple Top / Bottom.
- **Continuation Patterns**: Bullish / Bearish Flags, Pennants, Ascending / Descending Triangles.
- **Candlestick Formations**: Bullish Engulfing, Morning Star, Hammer, Piercing Line.

#### Detailed Interface Workflow
1. **Pattern Scanner Side Panel**: Live list of detected patterns across all monitored indices sorted by confidence score (e.g., `NIFTY 50 - Double Bottom Detected - 92% Confidence`).
2. **Visual Chart Overlay**: Highlights detected patterns directly on the execution chart with shaded trend boxes and target projection lines.
3. **Auto-Trade Toggle**: Enable **Auto-Trade Detected Patterns** with pre-configured risk parameters.

---

### 7.3 Module C: Visual Multi-Strategy Canvas Builder

#### Purpose & Core Vision
A visual no-code flowchart builder enabling traders to construct custom multi-leg algorithmic strategies by connecting drag-and-drop node blocks.

#### Node Block Specifications
- **Input Nodes**: Live Spot Price, Option Premium, Historical Candle, Time-of-Day Clock.
- **Indicator Nodes**: EMA, SMA, JMA, RSI, MACD, Bollinger Bands, ATR, Supertrend.
- **Logic Nodes**: AND, OR, Greater Than, Less Than, Crosses Above, Crosses Below.
- **Risk Nodes**: Fixed SL, Trailing SL, Percentage Target, Max Daily Drawdown.
- **Action Nodes**: Buy Call, Buy Put, Sell Call, Sell Put, Exit All.

#### Interface Workflow
1. **Canvas Workspace**: Grid canvas with drag-and-drop node palette.
2. **Node Wiring**: Connect output ports of indicator nodes to logic condition nodes.
3. **One-Click Strategy Compilation**: Compiles visual flowchart into executable backend JSON logic models.

---

### 7.4 Module D: Natural Language AI Trading Assistant

#### Purpose & Core Vision
An intelligent conversational assistant allowing traders to query market data, run analytics, build strategy rules, and execute orders using natural everyday English prompts.

#### Prompt Capabilities & Specifications
- **Natural Language Order Placement**: *"Buy 2 lots of NIFTY ATM Call if spot crosses 24,000 with a 20 point target."*
- **Market Query Analytics**: *"Show me today's highest momentum index option contract."*
- **Strategy Rule Generation**: *"Create a strategy that buys BANKNIFTY Put when 5m RSI drops below 30 and price is below 20 EMA."*
- **Interactive Conversational UI**: Floating AI drawer panel with instant text and voice command inputs.

---

## 8. Strategy Execution Engine & Lifecycle State Machine

### 8.1 Finite State Machine
The strategy runner (`SingleStrategyRunner`) executes a deterministic state machine:

```
[STOPPED] ---> (Start Command) ---> [WAITING / SCANNING]
                                          |
                                (Option Contracts Resolved)
                                          v
                                    [MONITORED]
                                          |
                               (Entry Signal Triggered)
                                          v
                                    [IN_TRADE]
                                          |
                              (Target / SL / Reversal)
                                          v
                                    [SCANNING]
```

### 8.2 State Descriptions
- `STOPPED`: Strategy engine inactive.
- `WAITING`: Initializing market session or candle lookback buffer.
- `SCANNING`: Evaluating indicator formulas and entry signal conditions.
- `MONITORED`: Resolved option contract tokens; streaming live LTP feeds.
- `IN_TRADE`: Order filled; actively monitoring tick prices for SL, Trailing SL, and Target exits.

---

## 9. Market Data Infrastructure & Order Execution Pipeline

### 9.1 Data Flow Architecture
1. **Python FastAPI Gateway**: Establishes HTTPS REST & WebSocket connections to Angel One SmartAPI.
2. **Node.js Candle Manager**: Aggregates OHLC candles, computes indicators (EMA, JMA, Heiken Ashi), and manages memory buffers.
3. **Execution Pipeline**: Upon signal detection, dispatches order requests to Python service `/angel/orders/simple`.
4. **Order Store Persistence**: Every order attempt is logged into an SQLite database (`orders.sqlite`) for complete auditability.

---

## 10. Risk Management Framework & Capital Preservation

### 10.1 Multi-Layered Risk Enforcement

| Risk Layer | Rule Specification | Operational Impact |
| :--- | :--- | :--- |
| **Hard Stop Loss** | Fixed point threshold defined on entry. | Triggers immediate market SELL order upon breach. |
| **Trailing Stop Loss** | Dynamic ratchet following price highs. | Locks in accrued profits as price advances. |
| **Single Trade Limit** | Max 1 open trade per strategy instance. | Prevents over-leveraging and duplicate entries. |
| **Index Lot Sizing** | Hardcoded lot multipliers. | Enforces valid contract quantities (NIFTY 65, BANKNIFTY 30, SENSEX 20, CRUDEOILM 1). |
| **Session Control** | Trading restricted to 09:15–15:30 IST. | Prevents off-market order placement errors. |

---

## 11. API Architecture & Interface Overview

### 11.1 API Module Summary Table

| Module | Endpoint Path | Method | Functionality Summary |
| :--- | :--- | :--- | :--- |
| **Auth** | `/api/v1/users/login` | `POST` | User login & JWT cookie issuance. |
| **Auth** | `/api/v1/users/me` | `GET` | Authenticated user profile retrieval. |
| **Broker** | `/angel/login` | `POST` | Angel One TOTP authentication. |
| **Broker** | `/angel/margins` | `GET` | Real-time account margin fetching. |
| **Broker** | `/angel/positions/exit` | `POST` | Immediate broker position liquidation. |
| **Strategy** | `/api/v1/strategies/:name/start` | `POST` | Start automated strategy engine instance. |
| **Strategy** | `/api/v1/strategies/:name/status` | `GET` | Retrieve strategy state, logs, and active trade. |
| **Trades** | `/api/v1/trades` | `GET` | Paginated trade audit history with multi-filtering. |
| **Market** | `/market/candles` | `GET` | Historical OHLC candle array fetch. |
| **Market** | `/instruments/index-options` | `GET` | Dynamic option chain lookup for ATM/ITM strikes. |

---

## 12. Database Architecture & Persistence Models

### 12.1 MongoDB Collections Schema Summary
- **`users` Collection**: Stores user email, hashed password (bcrypt), and account creation timestamps.
- **`strategies` Collection**: Maps strategy instances to user account IDs.
- **`trades` Collection**: Logs all completed and open trades with fields for `index`, `premium`, `qty`, `buyPrice`, `exitPrice`, `pnl`, and `exitReason`.

### 12.2 SQLite Transaction Store Schema Summary
- **`order_attempts` Table** (`angel-one/orders.sqlite`): Logs raw request payloads, unique UUID order IDs, UTC timestamps, and raw broker API response strings for execution auditing.

---

## 13. Security, Encryption & Broker Compliance

- **JWT Token Protection**: Authenticated tokens stored in `httpOnly` secure cookies.
- **TOTP Encryption**: Two-factor authentication keys managed locally via server environment variables.
- **Bcrypt Hashing**: Passwords encrypted with 10 salt rounds before storage.
- **Sanitized Error Responses**: Internal exception stack traces are suppressed in production mode.

---

## 14. Non-Functional System Requirements

- **Execution Speed**: Strategy signal to order dispatch completed in `< 500ms`.
- **UI Responsiveness**: 60 FPS chart rendering utilizing Canvas-based charting utilities.
- **System Uptime**: 99.9% availability during official Indian exchange trading hours.
- **Data Integrity**: Zero lost order records due to local SQLite persistence logging.

---

## 15. Comprehensive Trading & Financial Glossary

| Term | Definition |
| :--- | :--- |
| **LTP** | **Last Traded Price**: Most recent price at which an option contract executed. |
| **ATM** | **At-The-Money**: Option strike price closest to the underlying spot index price. |
| **ITM** | **In-The-Money**: Option contract containing intrinsic value. |
| **OTM** | **Out-of-The-Money**: Option contract consisting purely of extrinsic time value. |
| **Heiken Ashi** | Smoothed candlestick formulation that filters market noise to highlight trends. |
| **JMA** | **Jurik Moving Average**: Advanced low-lag, ultra-smooth moving average. |
| **EMA** | **Exponential Moving Average**: Weighted moving average prioritizing recent prices. |
| **TOTP** | **Time-based One-Time Password**: Dynamic security code generated via algorithm. |
| **MPIN** | **Mobile Personal Identification Number**: 4-digit broker security code. |
| **Slippage** | Difference between expected trade entry price and actual execution price. |
