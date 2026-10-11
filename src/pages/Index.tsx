import { Link } from 'react-router-dom';
import {
  PenTool, Cpu, MapPin, Layers, BarChart3, MousePointerClick,
  Search, FileText, ArrowRight, Globe, Shield, Factory, Compass, Mountain
} from 'lucide-react';

const modules = [
  {
    icon: <Search size={24} />,
    title: 'Global Site Search',
    desc: 'Search locations worldwide using Nominatim & Overpass for potential factory sites.',
    color: 'text-primary',
  },
  {
    icon: <Layers size={24} />,
    title: 'Cadastral Overlay',
    desc: 'Bhuvan ISRO WMS layers for cadastral reference where publicly available.',
    color: 'text-accent',
  },
  {
    icon: <PenTool size={24} />,
    title: 'Site Boundary Drawing',
    desc: 'Draw polygons, rectangles, and circles with full vertex editing and deletion.',
    color: 'text-success',
  },
  {
    icon: <Cpu size={24} />,
    title: 'AI Segmentation',
    desc: 'Point-based include/exclude seed segmentation with adaptive boundary expansion.',
    color: 'text-warning',
  },
  {
    icon: <BarChart3 size={24} />,
    title: 'Site Analytics',
    desc: 'Precise area (sq.m, acres, hectares) and perimeter calculations with confidence scoring.',
    color: 'text-primary',
  },
  {
    icon: <MousePointerClick size={24} />,
    title: 'Land Intelligence',
    desc: 'Right-click any point to fetch nearby roads, amenities, admin boundaries from OSM.',
    color: 'text-accent',
  },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
        <div className="relative max-w-4xl mx-auto px-6 pt-16 pb-12 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/15 text-primary text-xs font-medium mb-6">
            <Factory size={14} />
            Ashok Leyland — Industrial Land Scouting
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">
            <span className="text-primary">AL-Scout</span>{' '}
            <span className="text-accent">3D</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-8">
            High-performance industrial land scouting & area calculator.
            Identify potential factory sites, draw boundaries, and calculate precise measurements
            using satellite imagery and geospatial AI.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
            <Link
              to="/draw"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg"
            >
              <PenTool size={18} />
              Draw Site Boundary
              <ArrowRight size={16} />
            </Link>
            <Link
              to="/segment"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg"
            >
              <Cpu size={18} />
              AI Segmentation
              <ArrowRight size={16} />
            </Link>
            <Link
              to="/sample-area-estimation"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg"
            >
              <BarChart3 size={18} />
              Sample Estimation
              <ArrowRight size={16} />
            </Link>
          </div>

          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-card/60 px-4 py-2 rounded-lg border border-border">
            <Shield size={14} className="text-destructive" />
            Preliminary assessment only — not a legal survey.
          </div>
        </div>
      </div>

      {/* Modules Grid */}
      <div className="max-w-4xl mx-auto px-6 pb-16">
        <h2 className="text-xl font-bold text-center mb-8">Scouting Modules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((m, i) => (
            <div
              key={i}
              className="glass-panel rounded-xl p-5 space-y-2 hover:border-primary/30 transition-colors"
            >
              <div className={m.color}>{m.icon}</div>
              <h3 className="text-sm font-semibold text-foreground">{m.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
            </div>
          ))}
        </div>

        {/* Jury Talking Points */}
        <div className="mt-12 glass-panel rounded-xl p-6">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Compass size={16} className="text-accent" />
            Technology Stack
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
            <p>✓ Leaflet.js — high-resolution interactive map engine</p>
            <p>✓ Turf.js — geodesic area & perimeter calculations</p>
            <p>✓ ESRI World Imagery — satellite tiles</p>
            <p>✓ OpenStreetMap — roads, buildings, POIs</p>
            <p>✓ Nominatim — global geocoding API</p>
            <p>✓ Overpass API — detailed OSM queries</p>
            <p>✓ OpenTopoMap — terrain visualization</p>
            <p>✓ Bhuvan ISRO — WMS cadastral layers</p>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-6 text-center text-[10px] text-muted-foreground space-y-0.5">
          <p>⚠ This is a preliminary scouting tool for site assessment only.</p>
          <p>⚠ Accuracy depends on satellite image quality. Best results with clear boundaries.</p>
          <p>⚠ For official surveys, consult a licensed land surveyor.</p>
        </div>
      </div>
    </div>
  );
};

export default Index;
