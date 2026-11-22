import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import ScreenerDashboard from './pages/ScreenerDashboard';
import StockDetails from './pages/StockDetails';
import GoalPathPlanner from './pages/GoalPathPlanner';
import HowItWorks from './pages/HowItWorks';

function NavigationHeader() {
  const location = useLocation();
  const currentPath = location.pathname;

  const getLinkClass = (path) => {
    const isActive = currentPath === path;
    const baseClass = "h-[36px] flex items-center px-4 rounded-[6px] text-[14px] font-medium transition-all select-none";
    return isActive 
      ? `${baseClass} bg-[#eff4ff] text-[#1a56db]`
      : `${baseClass} text-[#444444] hover:text-[#1a56db] hover:bg-[#eff4ff]/50`;
  };

  return (
    <header className="h-[52px] min-h-[52px] bg-white border-b border-[#e8eaed] sticky top-0 z-50 px-6 flex items-center justify-between">
      {/* Left logo */}
      <Link to="/" className="flex items-center gap-2 select-none">
        <div className="w-[28px] h-[28px] bg-[#1a56db] rounded flex items-center justify-center text-white font-extrabold text-[16px]">
          S
        </div>
        <span className="text-[16px] font-medium text-[#111111]">
          StockSense
        </span>
      </Link>

      {/* Centre Links */}
      <nav className="flex items-center gap-2">
        <Link to="/" className={getLinkClass('/')}>
          Screener
        </Link>
        <Link to="/planner" className={getLinkClass('/planner')}>
          Goal planner
        </Link>
        <Link to="/how-it-works" className={getLinkClass('/how-it-works')}>
          How it works
        </Link>
      </nav>

      {/* Right button */}
      <div>
        <button className="h-[36px] px-4 bg-[#1a56db] text-white rounded-[7px] text-[13px] font-medium transition-opacity hover:opacity-90 select-none">
          Sign up free
        </button>
      </div>
    </header>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-bgDark text-textLight flex flex-col">
        {/* Navigation Header */}
        <NavigationHeader />

        {/* Main Workspace */}
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<ScreenerDashboard />} />
            <Route path="/stock/:ticker" element={<StockDetails />} />
            <Route path="/planner" element={<GoalPathPlanner />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="*" element={
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-center bg-white">
                <h2 className="text-xl font-medium text-textHeading mb-2">404 - Page Not Found</h2>
                <p className="text-textBody mb-6">The page you are looking for does not exist.</p>
                <Link to="/" className="px-4 py-2 bg-primaryBlue text-white rounded-[7px] font-medium text-sm transition-opacity hover:opacity-90">
                  Return to Screener
                </Link>
              </div>
            } />
          </Routes>
        </main>

        {/* Trust Bar Footer */}
        <footer className="h-10 min-h-[40px] bg-white border-t border-[#e8eaed] px-6 flex items-center justify-between text-[#888888] select-none text-[11px] font-medium z-10">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2e7d32]"></span>
              <span>Live NSE/BSE data</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1a56db]"></span>
              <span>Yahoo Finance sourced</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#b45309]"></span>
              <span>Not financial advice</span>
            </div>
          </div>
          <div className="text-[#9aa0aa]">
            Last updated 2 min ago
          </div>
        </footer>
      </div>
    </Router>
  );
}

export default App;
