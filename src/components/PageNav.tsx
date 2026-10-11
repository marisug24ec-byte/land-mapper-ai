import { Link, useLocation } from 'react-router-dom';
import { PenTool, Cpu } from 'lucide-react';

export const PageNav = () => {
  const { pathname } = useLocation();

  return (
    <div className="absolute top-[60px] left-1/2 -translate-x-1/2 z-[1000]">
      <div className="glass-panel rounded-xl p-1 flex gap-1">
        <Link
          to="/draw"
          className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-medium flex items-center gap-2 transition-all ${
            pathname === '/draw' || pathname === '/'
              ? 'bg-primary text-primary-foreground shadow-md'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
        >
          <PenTool size={16} />
          <span className="hidden sm:inline">Draw Boundary</span>
          <span className="sm:hidden">Draw</span>
        </Link>
        <Link
          to="/segment"
          className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-medium flex items-center gap-2 transition-all ${
            pathname === '/segment'
              ? 'bg-primary text-primary-foreground shadow-md'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
        >
          <Cpu size={16} />
          <span className="hidden sm:inline">AI Segmentation</span>
          <span className="sm:hidden">AI</span>
        </Link>
      </div>
    </div>
  );
};
