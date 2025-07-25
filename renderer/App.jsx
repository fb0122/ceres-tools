import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import DateList from './components/DateList';
import ResultPage from './components/ResultPage';

function App() {
  return (
    <Router>
      <div style={{ padding: 32 }}>
        <h1>股票行业成交额统计</h1>
        <Routes>
          <Route path="/" element={<DateList />} />
          <Route path="/result/:date" element={<ResultPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App; 