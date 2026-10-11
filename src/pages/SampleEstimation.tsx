import { useRef, useState, useCallback, useEffect } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import {
  Pentagon, Play, Plus, Square as StopIcon, RotateCcw, Navigation, Check, X,
  Pencil, Trash2, BarChart3, Home,
} from 'lucide-react';
import { useMapSetup } from '../hooks/useMapSetup';
import { useNavigate } from 'react-router-dom';
import { SearchPanel } from '../components/SearchPanel';
import { LandDetailsPanel } from '../components/LandDetailsPanel';
import { ResultsPanel } from '../components/ResultsPanel';
import {
  MapType,
  Measurement,
  coordsToMeasurement,
  exportPdf,
  saveProject,
} from '../utils/mapHelpers';

type Phase = 'draw' | 'sampling' | 'done';

interface SamplePoint {
  latlng: L.LatLng;
  classification: 'land' | 'nonland';
  marker: L.CircleMarker;
}

// ---- helpers ----

/** Binomial confidence interval width (Wilson score simplified).
 *  Returns the half-width of the 95% CI for proportion p with n samples. */
function marginOfError(p: number, n: number, z = 1.96): number {
  if (n === 0) return 1;
  return z * Math.sqrt((p * (1 - p)) / n);
}

/** Classify a point by sampling the satellite tile pixel colour.
 *  Green-ish / brown-ish → land.  Blue / grey / very dark → non-land.
 *  We pull the pixel from the map's tile layer canvas. */
/** Advanced pixel classification for land vs non-land detection.
 *  Detects: roads, buildings, water, rivers, concrete, roofs, ponds, drainage.
 *  Green = land (soil, grass, vegetation, agricultural land, empty fields).
 *  Red = non-land (roads, rivers, water, buildings, concrete, roofs, ponds). */
function classifyPixel(r: number, g: number, b: number): 'land' | 'nonland' {
  const brightness = (r + g + b) / 3;
  const greenDominance = g - (r + b) / 2;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;

  // --- NON-LAND DETECTION ---

  // Water / Rivers / Ponds → blue dominant
  if (b > r + 15 && b > g + 10 && brightness < 160) return 'nonland';
  // Deep water / dark ponds
  if (b > r && b > g && brightness < 60) return 'nonland';
  // Very dark (shadows, deep water, drainage)
  if (brightness < 30) return 'nonland';

  // Concrete / Roads / Grey surfaces → neutral grey, low saturation
  if (brightness > 100 && brightness < 220 && saturation < 0.12 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) return 'nonland';
  // Asphalt roads → dark grey
  if (brightness > 40 && brightness < 110 && saturation < 0.15 && Math.abs(r - g) < 15 && Math.abs(g - b) < 15) return 'nonland';
  // Light concrete / white buildings / roofs
  if (brightness > 210 && saturation < 0.1) return 'nonland';

  // Buildings / Roofs → reddish-brown with low green (terracotta, metal roofs)
  if (r > 140 && r > g + 30 && r > b + 40 && saturation > 0.2) return 'nonland';
  // Blue/grey metal roofs
  if (b > 100 && b > r && brightness > 100 && brightness < 180 && saturation < 0.3) return 'nonland';

  // Sand / Desert (very light tan, low saturation) → could be construction site
  if (brightness > 190 && r > g && r > b && saturation < 0.15) return 'nonland';

  // --- LAND DETECTION ---

  // Green vegetation (grass, crops, trees)
  if (greenDominance > 8) return 'land';
  // Dark green vegetation
  if (g > r && g > b && g > 50 && saturation > 0.15) return 'land';
  // Brown / tan earth / soil
  if (r > 80 && g > 60 && b < g && r > b && saturation > 0.1 && brightness < 190) return 'land';
  // Reddish soil (laterite)
  if (r > 100 && g > 40 && g < r && b < g && brightness < 160) return 'land';
  // Dark soil
  if (brightness > 30 && brightness < 80 && saturation < 0.2 && r > b) return 'land';

  // Default: treat unclear pixels as land (conservative approach for open areas)
  return brightness < 150 ? 'land' : 'nonland';
}

function classifyPixelColor(
  map: L.Map,
  container: HTMLDivElement,
  latlng: L.LatLng,
): 'land' | 'nonland' {
  const point = map.latLngToContainerPoint(latlng);

  // Try canvas tiles first
  const canvases = container.querySelectorAll<HTMLCanvasElement>('canvas');
  for (const canvas of canvases) {
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      const rect = canvas.getBoundingClientRect();
      const cx = point.x - rect.left + container.scrollLeft;
      const cy = point.y - rect.top + container.scrollTop;
      if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) continue;
      const px = ctx.getImageData(Math.floor(cx), Math.floor(cy), 1, 1).data;
      return classifyPixel(px[0], px[1], px[2]);
    } catch { continue; }
  }

  // Fallback: tile images
  const imgs = container.querySelectorAll<HTMLImageElement>('.leaflet-tile');
  for (const img of imgs) {
    try {
      const rect = img.getBoundingClientRect();
      const cx = point.x - rect.left;
      const cy = point.y - rect.top;
      if (cx < 0 || cy < 0 || cx >= img.width || cy >= img.height) continue;
      const offscreen = document.createElement('canvas');
      offscreen.width = img.naturalWidth;
      offscreen.height = img.naturalHeight;
      const octx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!octx) continue;
      octx.drawImage(img, 0, 0);
      const sx = (cx / img.width) * img.naturalWidth;
      const sy = (cy / img.height) * img.naturalHeight;
      const px = octx.getImageData(Math.floor(sx), Math.floor(sy), 1, 1).data;
      return classifyPixel(px[0], px[1], px[2]);
    } catch { continue; }
  }

  return 'land';
}

// ---- component ----

const SampleEstimation = () => {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const {
    mapRef, mapType, setMapType, handleZoom, handleLocateMe, statusText, setStatusText,
  } = useMapSetup(mapContainerRef);

  // Drawing refs
  const drawnLayersRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const tempLayersRef = useRef<L.LayerGroup>(new L.LayerGroup());
  const sampleMarkersRef = useRef<L.LayerGroup>(new L.LayerGroup());
  const drawPointsRef = useRef<L.LatLng[]>([]);

  // State
  const [phase, setPhase] = useState<Phase>('draw');
  const [drawMode, setDrawMode] = useState<'polygon' | 'none'>('none');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPointCount, setDrawPointCount] = useState(0);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  // SBAE state
  const polygonGeoJsonRef = useRef<any>(null);
  const polygonLayerRef = useRef<L.Polygon | null>(null);
  const samplesRef = useRef<SamplePoint[]>([]);
  const [sampleStats, setSampleStats] = useState({ total: 0, land: 0, nonland: 0 });
  const [confidence, setConfidence] = useState(0);
  const [moe, setMoe] = useState(0);
  const [estimatedArea, setEstimatedArea] = useState<{ sqm: number; acres: number; ha: number } | null>(null);
  const [isSampling, setIsSampling] = useState(false);
  const [autoSampling, setAutoSampling] = useState(false);
  const autoSamplingRef = useRef(false);

  // Add layers to map
  useEffect(() => {
    const checkMap = setInterval(() => {
      if (mapRef.current) {
        drawnLayersRef.current.addTo(mapRef.current);
        tempLayersRef.current.addTo(mapRef.current);
        sampleMarkersRef.current.addTo(mapRef.current);
        clearInterval(checkMap);
      }
    }, 100);
    return () => clearInterval(checkMap);
  }, [mapRef]);

  // Dragging control
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawMode === 'polygon') {
      map.doubleClickZoom.disable();
      map.dragging.disable();
    } else {
      map.doubleClickZoom.enable();
      map.dragging.enable();
    }
    return () => { if (map) { map.doubleClickZoom.enable(); map.dragging.enable(); } };
  }, [drawMode, mapRef]);

  // Duplicate vertex prevention
  const isDuplicate = useCallback((ll: L.LatLng) => {
    const pts = drawPointsRef.current;
    return pts.length > 0 && pts[pts.length - 1].distanceTo(ll) < 2;
  }, []);

  // Self-intersection check
  const hasSelfIntersection = useCallback((coords: L.LatLng[]) => {
    if (coords.length < 4) return false;
    try {
      const ring = coords.map(c => [c.lng, c.lat]);
      ring.push([coords[0].lng, coords[0].lat]);
      return turf.kinks(turf.polygon([ring])).features.length > 0;
    } catch { return false; }
  }, []);

  const resetDrawing = useCallback(() => {
    tempLayersRef.current.clearLayers();
    drawPointsRef.current = [];
    setIsDrawing(false);
    setDrawPointCount(0);
  }, []);

  const finishPolygon = useCallback(() => {
    const pts = drawPointsRef.current;
    if (pts.length < 3) return;
    if (hasSelfIntersection(pts)) {
      setStatusText('⚠ Polygon self-intersects — fix vertices');
      return;
    }

    const polygon = L.polygon(pts, {
      color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 2,
    });
    drawnLayersRef.current.addLayer(polygon);
    polygonLayerRef.current = polygon;

    // Build GeoJSON
    const ring = pts.map(c => [c.lng, c.lat]);
    ring.push([pts[0].lng, pts[0].lat]);
    polygonGeoJsonRef.current = turf.polygon([ring]);

    const m = coordsToMeasurement(pts, 95);
    if (m) setMeasurement(m);

    resetDrawing();
    setDrawMode('none');
    setPhase('sampling');
    setStatusText('Boundary drawn — start sampling');
  }, [hasSelfIntersection, resetDrawing, setStatusText]);

  // Drawing click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map || phase !== 'draw') return;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (drawMode !== 'polygon') return;
      if (isDuplicate(e.latlng)) return;

      const pts = drawPointsRef.current;
      if (pts.length >= 3) {
        const first = pts[0];
        const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(first));
        if (dist < 15) { finishPolygon(); return; }
      }

      drawPointsRef.current.push(e.latlng);
      setDrawPointCount(drawPointsRef.current.length);
      setIsDrawing(true);
      L.circleMarker(e.latlng, { radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 })
        .addTo(tempLayersRef.current);
      setStatusText(`${drawPointsRef.current.length} vertices — click first point or Finish`);
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      tempLayersRef.current.eachLayer(l => { if ((l as any)._isPreview) tempLayersRef.current.removeLayer(l); });
      if (drawMode === 'polygon' && drawPointsRef.current.length > 0) {
        const line = L.polyline([...drawPointsRef.current, e.latlng], {
          color: '#3b82f6', weight: 2, dashArray: '6 4', opacity: 0.7,
        });
        (line as any)._isPreview = true;
        line.addTo(tempLayersRef.current);

        if (drawPointsRef.current.length >= 3) {
          const first = drawPointsRef.current[0];
          const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(first));
          if (dist < 15) {
            const snap = L.circleMarker(first, { radius: 8, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.6, weight: 2 });
            (snap as any)._isPreview = true;
            snap.addTo(tempLayersRef.current);
          }
        }
      }
    };

    map.on('click', onClick);
    map.on('mousemove', onMouseMove);
    const container = map.getContainer();
    container.style.cursor = drawMode === 'polygon' ? 'crosshair' : '';
    return () => { map.off('click', onClick); map.off('mousemove', onMouseMove); container.style.cursor = ''; };
  }, [phase, drawMode, mapRef, isDuplicate, finishPolygon, setStatusText]);

  // ---- Sampling Logic ----

  const recalcStats = useCallback(() => {
    const samples = samplesRef.current;
    const total = samples.length;
    const land = samples.filter(s => s.classification === 'land').length;
    const nonland = total - land;
    const p = total > 0 ? land / total : 0;
    const moeVal = marginOfError(p, total);
    const conf = total > 0 ? Math.min(99, Math.round((1 - moeVal) * 100)) : 0;

    setSampleStats({ total, land, nonland });
    setMoe(Math.round(moeVal * 10000) / 100); // percentage
    setConfidence(conf);

    if (polygonGeoJsonRef.current && total > 0) {
      const polyArea = turf.area(polygonGeoJsonRef.current);
      const est = polyArea * p;
      setEstimatedArea({ sqm: est, acres: est * 0.000247105, ha: est * 0.0001 });
      setMeasurement({
        areaSqm: est,
        areaAcres: est * 0.000247105,
        areaHectares: est * 0.0001,
        perimeterM: measurement?.perimeterM ?? 0,
        confidence: conf,
      });
    }

    return { conf, moeVal };
  }, [measurement?.perimeterM]);

  const addSampleBatch = useCallback((count: number) => {
    const map = mapRef.current;
    const geojson = polygonGeoJsonRef.current;
    if (!map || !geojson || !mapContainerRef.current) return;

    setIsSampling(true);

    // Generate random points inside polygon using turf
    const bbox = turf.bbox(geojson);
    const existingCoords = new Set(samplesRef.current.map(s => `${s.latlng.lat.toFixed(6)},${s.latlng.lng.toFixed(6)}`));

    let added = 0;
    let attempts = 0;
    const maxAttempts = count * 10;

    while (added < count && attempts < maxAttempts) {
      attempts++;
      // Random point in bbox
      const lng = bbox[0] + Math.random() * (bbox[2] - bbox[0]);
      const lat = bbox[1] + Math.random() * (bbox[3] - bbox[1]);
      const pt = turf.point([lng, lat]);

      if (!turf.booleanPointInPolygon(pt, geojson)) continue;

      const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
      if (existingCoords.has(key)) continue;
      existingCoords.add(key);

      const latlng = L.latLng(lat, lng);
      const classification = classifyPixelColor(map, mapContainerRef.current!, latlng);

      const color = classification === 'land' ? '#22c55e' : '#ef4444';
      const marker = L.circleMarker(latlng, {
        radius: 5, color, fillColor: color, fillOpacity: 0.85, weight: 1,
      }).addTo(sampleMarkersRef.current);

      samplesRef.current.push({ latlng, classification, marker });
      added++;
    }

    const { conf } = recalcStats();
    setIsSampling(false);
    setStatusText(`+${added} samples (total ${samplesRef.current.length}) — Confidence: ${conf}%`);

    return conf;
  }, [mapRef, recalcStats, setStatusText]);

  // Auto-sampling loop
  const runAutoSampling = useCallback(async () => {
    autoSamplingRef.current = true;
    setAutoSampling(true);

    const loop = () => {
      if (!autoSamplingRef.current) {
        setAutoSampling(false);
        return;
      }
      const conf = addSampleBatch(20);
      if (conf !== undefined && conf >= 95) {
        autoSamplingRef.current = false;
        setAutoSampling(false);
        setPhase('done');
        setStatusText(`✓ Confidence reached ${conf}% — sampling complete`);
        return;
      }
      // Continue after a small delay to let UI breathe
      setTimeout(loop, 300);
    };
    loop();
  }, [addSampleBatch, setStatusText]);

  const stopAutoSampling = useCallback(() => {
    autoSamplingRef.current = false;
    setAutoSampling(false);
    setStatusText('Sampling stopped manually');
  }, [setStatusText]);

  const handleStartSampling = useCallback(() => {
    addSampleBatch(20);
  }, [addSampleBatch]);

  const handleAdd20 = useCallback(() => {
    addSampleBatch(20);
  }, [addSampleBatch]);

  const handleClearAll = useCallback(() => {
    drawnLayersRef.current.clearLayers();
    tempLayersRef.current.clearLayers();
    sampleMarkersRef.current.clearLayers();
    drawPointsRef.current = [];
    polygonGeoJsonRef.current = null;
    polygonLayerRef.current = null;
    samplesRef.current = [];
    autoSamplingRef.current = false;
    setAutoSampling(false);
    setPhase('draw');
    setDrawMode('none');
    setIsDrawing(false);
    setDrawPointCount(0);
    setMeasurement(null);
    setSampleStats({ total: 0, land: 0, nonland: 0 });
    setConfidence(0);
    setMoe(0);
    setEstimatedArea(null);
    setStatusText('All cleared');
  }, [setStatusText]);

  const handleSave = useCallback(() => {
    const layers: any[] = [];
    if (polygonLayerRef.current) {
      layers.push({ type: 'sbae-polygon', latlngs: polygonLayerRef.current.getLatLngs() });
    }
    saveProject(layers, measurement, 'sbae');
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 2000);
  }, [measurement]);

  const handleExport = useCallback(() => {
    if (measurement) exportPdf(measurement);
  }, [measurement]);

  // Toolbar button helper
  const ToolBtn = ({ icon, label, active, onClick, disabled, variant }: {
    icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; disabled?: boolean;
    variant?: 'danger' | 'success' | 'primary';
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? 'bg-primary text-primary-foreground shadow-md'
          : variant === 'success'
          ? 'bg-success text-success-foreground shadow-md'
          : variant === 'primary'
          ? 'bg-primary text-primary-foreground shadow-md'
          : variant === 'danger'
          ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />

      {/* No PageNav here — SBAE is a dedicated standalone page */}
      <SearchPanel mapRef={mapRef as React.RefObject<L.Map | null>} setStatusText={setStatusText} />
      <LandDetailsPanel mapRef={mapRef as React.RefObject<L.Map | null>} enabled={drawMode === 'none' && phase !== 'draw'} />

      {/* Back to Home + Title */}
      <div className="absolute top-4 left-4 z-[1000] flex items-center gap-2">
        <button
          onClick={() => { handleClearAll(); navigate('/'); }}
          className="glass-panel rounded-xl px-3 py-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Home size={14} />
          Back to Home
        </button>
        <div className="glass-panel rounded-xl px-3 py-2">
          <h1 className="text-base font-bold text-primary tracking-tight">AL-Scout 3D</h1>
          <p className="text-[9px] text-muted-foreground">Sample-Based Area Estimation</p>
        </div>
      </div>

      {/* Map Type + Zoom */}
      <div className="absolute top-16 right-4 z-[1000] space-y-2">
        <div className="glass-panel rounded-xl p-1 flex gap-1">
          {(['normal', 'satellite', 'terrain', 'bhuvan'] as MapType[]).map(type => (
            <button key={type} onClick={() => setMapType(type)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                mapType === type ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >{type === 'bhuvan' ? 'Bhuvan' : type.charAt(0).toUpperCase() + type.slice(1)}</button>
          ))}
        </div>
        <div className="glass-panel rounded-xl flex flex-col overflow-hidden">
          <button onClick={() => handleZoom(1)} className="px-3 py-1.5 text-foreground hover:bg-secondary transition-colors text-base font-bold">+</button>
          <div className="h-px bg-border" />
          <button onClick={() => handleZoom(-1)} className="px-3 py-1.5 text-foreground hover:bg-secondary transition-colors text-base font-bold">−</button>
        </div>
      </div>

      {/* Left Toolbar */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-[1000]">
        <div className="glass-panel rounded-xl p-1.5 flex flex-col gap-1">
          {phase === 'draw' && (
            <>
              <ToolBtn icon={<Pentagon size={18} />} label="Draw Boundary" active={drawMode === 'polygon'}
                onClick={() => { setDrawMode(d => d === 'polygon' ? 'none' : 'polygon'); setStatusText('Click to place polygon vertices'); }} />
              {isDrawing && drawPointCount >= 3 && (
                <ToolBtn icon={<Check size={18} />} label="Finish Polygon" onClick={finishPolygon} variant="success" />
              )}
              {isDrawing && (
                <ToolBtn icon={<X size={18} />} label="Cancel" onClick={() => { resetDrawing(); setDrawMode('none'); setStatusText(''); }} variant="danger" />
              )}
            </>
          )}

          {phase === 'sampling' && (
            <>
              <ToolBtn icon={<Play size={18} />} label="Start Sampling (20 pts)" onClick={handleStartSampling}
                disabled={isSampling || autoSampling} variant="primary" />
              <ToolBtn icon={<Plus size={18} />} label="Add 20 More" onClick={handleAdd20}
                disabled={isSampling || autoSampling || sampleStats.total === 0} />
              <ToolBtn icon={<BarChart3 size={18} />} label="Auto Sample to 95%"
                onClick={autoSampling ? stopAutoSampling : runAutoSampling}
                active={autoSampling}
                variant={autoSampling ? 'danger' : 'success'} />
            </>
          )}

          {phase === 'done' && (
            <ToolBtn icon={<Plus size={18} />} label="Add 20 More" onClick={() => { setPhase('sampling'); handleAdd20(); }} />
          )}

          <div className="h-px bg-border mx-1 my-0.5" />
          <ToolBtn icon={<RotateCcw size={18} />} label="Clear All" onClick={handleClearAll} />
          <ToolBtn icon={<Navigation size={18} />} label="Locate Me" onClick={handleLocateMe} />
        </div>

        {/* Phase indicator */}
        <div className="glass-panel rounded-lg p-2 mt-2 text-[10px] space-y-1">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full inline-block ${phase === 'draw' ? 'bg-primary animate-pulse' : 'bg-muted'}`} />
            <span className={phase === 'draw' ? 'text-foreground font-medium' : 'text-muted-foreground'}>1. Draw Boundary</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full inline-block ${phase === 'sampling' ? 'bg-primary animate-pulse' : phase === 'done' ? 'bg-success' : 'bg-muted'}`} />
            <span className={phase === 'sampling' ? 'text-foreground font-medium' : 'text-muted-foreground'}>2. Sample & Classify</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full inline-block ${phase === 'done' ? 'bg-success animate-pulse' : 'bg-muted'}`} />
            <span className={phase === 'done' ? 'text-success font-medium' : 'text-muted-foreground'}>3. Results</span>
          </div>
        </div>

        {/* Vertex count during drawing */}
        {phase === 'draw' && isDrawing && (
          <div className="glass-panel rounded-lg p-2 mt-2 text-[10px] text-muted-foreground">
            Vertices: <span className="text-foreground font-mono">{drawPointCount}</span>
          </div>
        )}
      </div>

      {/* Sampling Stats Panel (right side) */}
      {phase !== 'draw' && (
      <div className="absolute top-28 right-4 z-[1100] w-56 sm:w-64 max-h-[calc(100vh-140px)] overflow-y-auto">
          <div className="rounded-xl p-4 sm:p-5 space-y-3" style={{ background: 'hsl(222 22% 12% / 0.95)', backdropFilter: 'blur(20px)', border: '1px solid hsl(220 15% 22% / 0.6)', boxShadow: '0 12px 40px hsl(0 0% 0% / 0.5)', borderRadius: '1rem' }}>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BarChart3 size={14} className="text-primary" />
              Sampling Results
            </h2>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <span className="text-muted-foreground">Total Samples</span>
              <span className="text-foreground font-mono text-right">{sampleStats.total}</span>
              <span className="text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-full bg-success mr-1" />Land
              </span>
              <span className="text-foreground font-mono text-right">{sampleStats.land}</span>
              <span className="text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-full bg-destructive mr-1" />Non-Land
              </span>
              <span className="text-foreground font-mono text-right">{sampleStats.nonland}</span>
            </div>

            <div className="h-px bg-border" />

            {/* Confidence meter */}
            <div>
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-muted-foreground">Confidence</span>
                <span className={`font-semibold ${confidence >= 95 ? 'text-success' : confidence >= 80 ? 'text-warning' : 'text-destructive'}`}>
                  {confidence}%
                </span>
              </div>
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    confidence >= 95 ? 'bg-success' : confidence >= 80 ? 'bg-warning' : 'bg-destructive'
                  }`}
                  style={{ width: `${Math.min(confidence, 100)}%` }}
                />
              </div>
              <div className="text-[9px] text-muted-foreground mt-1">
                Margin of Error: ±{moe.toFixed(2)}%
              </div>
              {confidence < 95 && sampleStats.total > 0 && (
                <div className="text-[9px] text-warning mt-0.5">
                  ⚠ Boundary may be inaccurate — add more samples
                </div>
              )}
              {confidence >= 95 && (
                <div className="text-[9px] text-success mt-0.5">
                  ✓ High Confidence Boundary
                </div>
              )}
            </div>

            <div className="h-px bg-border" />

            {/* Area Breakdown: Land + Non-Land + Total */}
            {estimatedArea && polygonGeoJsonRef.current && (
              <div className="space-y-2">
                <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Area Breakdown</h3>
                
                {/* Total Area */}
                <div className="space-y-1">
                  <div className="text-[10px] font-medium text-foreground flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary inline-block" /> Total Area
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs pl-3">
                    <span className="text-muted-foreground">m²</span>
                    <span className="text-foreground font-mono text-right">{(turf.area(polygonGeoJsonRef.current)).toFixed(2)}</span>
                    <span className="text-muted-foreground">Acres</span>
                    <span className="text-foreground font-mono text-right">{(turf.area(polygonGeoJsonRef.current) * 0.000247105).toFixed(4)}</span>
                    <span className="text-muted-foreground">Ha</span>
                    <span className="text-foreground font-mono text-right">{(turf.area(polygonGeoJsonRef.current) * 0.0001).toFixed(4)}</span>
                  </div>
                </div>

                {/* Land Area */}
                <div className="space-y-1">
                  <div className="text-[10px] font-medium text-success flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-success inline-block" /> Land Area
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs pl-3">
                    <span className="text-muted-foreground">m²</span>
                    <span className="text-foreground font-mono text-right">{estimatedArea.sqm.toFixed(2)}</span>
                    <span className="text-muted-foreground">Acres</span>
                    <span className="text-foreground font-mono text-right">{estimatedArea.acres.toFixed(4)}</span>
                    <span className="text-muted-foreground">Ha</span>
                    <span className="text-foreground font-mono text-right">{estimatedArea.ha.toFixed(4)}</span>
                  </div>
                </div>

                {/* Non-Land Area */}
                {sampleStats.nonland > 0 && (() => {
                  const totalArea = turf.area(polygonGeoJsonRef.current);
                  const nonLandArea = totalArea - estimatedArea.sqm;
                  return (
                    <div className="space-y-1">
                      <div className="text-[10px] font-medium text-destructive flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-destructive inline-block" /> Non-Land Area
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs pl-3">
                        <span className="text-muted-foreground">m²</span>
                        <span className="text-foreground font-mono text-right">{nonLandArea.toFixed(2)}</span>
                        <span className="text-muted-foreground">Acres</span>
                        <span className="text-foreground font-mono text-right">{(nonLandArea * 0.000247105).toFixed(4)}</span>
                        <span className="text-muted-foreground">Ha</span>
                        <span className="text-foreground font-mono text-right">{(nonLandArea * 0.0001).toFixed(4)}</span>
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-1">
                        Includes: roads, buildings, water, concrete
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="h-px bg-border" />

            {/* Formula info */}
            <details className="text-[9px] text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground transition-colors">
                📐 Statistical Method
              </summary>
              <div className="mt-1.5 space-y-0.5 leading-relaxed">
                <p>Land Ratio <span className="font-mono">p = land / total</span></p>
                <p>Est. Area = <span className="font-mono">Polygon Area × p</span></p>
                <p>MoE = <span className="font-mono">Z × √(p(1−p)/n)</span></p>
                <p>Confidence = <span className="font-mono">(1 − MoE) × 100</span></p>
                <p className="text-primary/70 pt-0.5">Z = 1.96 for 95% CI</p>
              </div>
            </details>
          </div>
        </div>
      )}

      {/* Results panel (measurement) */}
      {measurement && phase === 'done' && (
        <ResultsPanel
          measurement={measurement}
          showDisclaimer={showDisclaimer}
          onToggleDisclaimer={() => setShowDisclaimer(!showDisclaimer)}
          onSave={handleSave}
          onExport={handleExport}
          onClear={handleClearAll}
          showSaveSuccess={showSaveSuccess}
        />
      )}

      {/* Auto-sampling overlay */}
      {autoSampling && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="glass-panel rounded-xl px-4 py-2 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-success animate-pulse" />
            <span className="text-xs text-foreground">Auto-sampling… {sampleStats.total} pts — {confidence}%</span>
            <button onClick={stopAutoSampling} className="px-2 py-0.5 rounded bg-destructive text-destructive-foreground text-xs font-medium">
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Status */}
      {statusText && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="glass-panel rounded-full px-4 py-1.5 text-xs text-muted-foreground">{statusText}</div>
        </div>
      )}
    </div>
  );
};

export default SampleEstimation;
