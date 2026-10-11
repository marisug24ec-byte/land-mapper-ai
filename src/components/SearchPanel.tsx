import { useState, useRef, useCallback, useEffect } from 'react';
import { Search, X, Loader2, MapPin } from 'lucide-react';
import L from 'leaflet';

interface SearchResult {
  lat: string;
  lon: string;
  display_name: string;
  type: string;
  address: {
    state?: string;
    district?: string;
    country?: string;
    village?: string;
    town?: string;
    city?: string;
    [key: string]: string | undefined;
  };
}

interface SearchPanelProps {
  mapRef: React.RefObject<L.Map | null>;
  setStatusText: (text: string) => void;
}

const SEARCH_CACHE = new Map<string, SearchResult[]>();
const MAX_CACHE = 10;

export const SearchPanel = ({ mapRef, setStatusText }: SearchPanelProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState('');
  const markerRef = useRef<L.Marker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMarker = useCallback(() => {
    if (markerRef.current && mapRef.current) {
      mapRef.current.removeLayer(markerRef.current);
      markerRef.current = null;
    }
  }, [mapRef]);

  const searchNominatim = useCallback(async (q: string): Promise<SearchResult[]> => {
    const cacheKey = q.toLowerCase().trim();
    if (SEARCH_CACHE.has(cacheKey)) return SEARCH_CACHE.get(cacheKey)!;

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q + ', Tamil Nadu, India')}&countrycodes=in&addressdetails=1&limit=5`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('Search failed');
    const data: SearchResult[] = await res.json();

    // Filter for Tamil Nadu
    const filtered = data.filter(r => r.address?.state === 'Tamil Nadu');

    if (filtered.length > 0) {
      if (SEARCH_CACHE.size >= MAX_CACHE) {
        const firstKey = SEARCH_CACHE.keys().next().value;
        if (firstKey) SEARCH_CACHE.delete(firstKey);
      }
      SEARCH_CACHE.set(cacheKey, filtered);
    }

    return filtered;
  }, []);

  const searchOverpass = useCallback(async (q: string): Promise<SearchResult[]> => {
    const lowerQ = q.toLowerCase();
    const amenities = ['college', 'university', 'school', 'hospital'];
    const matchedAmenity = amenities.find(a => lowerQ.includes(a));

    if (!matchedAmenity) return [];

    const overpassQuery = `
      [out:json][timeout:15];
      area["ISO3166-2"="IN-TN"]->.searchArea;
      (
        node["amenity"="${matchedAmenity}"](area.searchArea);
        way["amenity"="${matchedAmenity}"](area.searchArea);
      );
      out center 5;
    `;

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(overpassQuery)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) throw new Error('Overpass failed');
    const data = await res.json();

    return (data.elements || [])
      .filter((el: any) => el.lat || el.center)
      .slice(0, 5)
      .map((el: any) => ({
        lat: String(el.lat || el.center?.lat),
        lon: String(el.lon || el.center?.lon),
        display_name: el.tags?.name || `${matchedAmenity} (Overpass)`,
        type: matchedAmenity,
        address: { state: 'Tamil Nadu', country: 'India' },
      }));
  }, []);

  const performSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setShowResults(false); return; }

    setLoading(true);
    setError('');

    try {
      let found = await searchNominatim(q);

      if (found.length === 0) {
        // Fallback to Overpass for colleges/universities/hospitals
        found = await searchOverpass(q);
      }

      if (found.length === 0) {
        setError('Location not found in Tamil Nadu.');
        setResults([]);
      } else {
        setResults(found);
        setShowResults(true);
      }
    } catch {
      setError('Search failed. Try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [searchNominatim, searchOverpass]);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => performSearch(value), 1000);
  };

  const selectResult = useCallback((result: SearchResult) => {
    const map = mapRef.current;
    if (!map) return;

    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);

    clearMarker();
    map.setView([lat, lon], 17);

    const popupContent = `
      <div style="font-size:12px;line-height:1.4;">
        <strong>${result.display_name.split(',')[0]}</strong><br/>
        ${result.address.district ? `District: ${result.address.district}<br/>` : ''}
        ${result.address.state || 'Tamil Nadu'}, ${result.address.country || 'India'}<br/>
        <em style="color:#888;font-size:10px;">Type: ${result.type}</em>
      </div>
    `;

    markerRef.current = L.marker([lat, lon])
      .addTo(map)
      .bindPopup(popupContent)
      .openPopup();

    setShowResults(false);
    setStatusText(`Found: ${result.display_name.split(',').slice(0, 2).join(',')}`);
  }, [mapRef, clearMarker, setStatusText]);

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setShowResults(false);
    setError('');
    clearMarker();
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] w-72 sm:w-80">
      <div className="glass-panel rounded-xl p-1.5">
        <div className="flex items-center gap-1.5">
          <Search size={14} className="text-muted-foreground ml-1.5 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') performSearch(query); }}
            placeholder="Search locations..."
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none py-1.5"
          />
          {loading && <Loader2 size={14} className="text-primary animate-spin shrink-0" />}
          {query && !loading && (
            <button onClick={handleClear} className="text-muted-foreground hover:text-foreground shrink-0">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="glass-panel rounded-lg mt-1 px-3 py-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {showResults && results.length > 0 && (
        <div className="glass-panel rounded-lg mt-1 max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => selectResult(r)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-secondary/50 transition-colors flex items-start gap-2 border-b border-border/30 last:border-0"
            >
              <MapPin size={12} className="text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-foreground truncate">{r.display_name.split(',').slice(0, 2).join(', ')}</p>
                <p className="text-muted-foreground text-[10px]">
                  {r.address.district && `${r.address.district} · `}{r.type}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
