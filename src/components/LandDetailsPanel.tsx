import { useState, useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import { X, MapPin, Loader2, Building2, Milestone, TreePine, Info } from 'lucide-react';

interface LandDetails {
  roads: string[];
  village: string;
  district: string;
  state: string;
  landUse: string;
  amenities: { name: string; type: string }[];
  adminBoundary: string;
  lat: number;
  lon: number;
}

interface LandDetailsPanelProps {
  mapRef: React.RefObject<L.Map | null>;
  enabled: boolean;
}

export const LandDetailsPanel = ({ mapRef, enabled }: LandDetailsPanelProps) => {
  const [details, setDetails] = useState<LandDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const markerRef = useRef<L.CircleMarker | null>(null);

  const fetchLandDetails = useCallback(async (lat: number, lon: number) => {
    setLoading(true);
    setVisible(true);

    try {
      // Overpass query for nearby features
      const radius = 200; // meters
      const query = `
        [out:json][timeout:15];
        (
          way["highway"](around:${radius},${lat},${lon});
          node["amenity"](around:${radius},${lat},${lon});
          way["amenity"](around:${radius},${lat},${lon});
          way["landuse"](around:${radius},${lat},${lon});
          relation["boundary"="administrative"](around:${radius},${lat},${lon});
        );
        out tags center 10;
      `;

      const [overpassRes, nominatimRes] = await Promise.all([
        fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`, {
          headers: { Accept: 'application/json' },
        }),
      ]);

      const overpassData = await overpassRes.json();
      const nominatimData = await nominatimRes.json();

      const roads: string[] = [];
      const amenities: { name: string; type: string }[] = [];
      let landUse = 'Unknown';
      let adminBoundary = '';

      (overpassData.elements || []).forEach((el: any) => {
        const tags = el.tags || {};
        if (tags.highway && tags.name) {
          roads.push(`${tags.name} (${tags.highway})`);
        }
        if (tags.amenity) {
          amenities.push({
            name: tags.name || tags.amenity,
            type: tags.amenity,
          });
        }
        if (tags.landuse) {
          landUse = tags.landuse;
        }
        if (tags.boundary === 'administrative' && tags.name) {
          adminBoundary = `${tags.name} (Level ${tags.admin_level || '?'})`;
        }
      });

      const addr = nominatimData.address || {};

      setDetails({
        roads: [...new Set(roads)].slice(0, 5),
        village: addr.village || addr.town || addr.city || addr.suburb || '',
        district: addr.county || addr.state_district || '',
        state: addr.state || '',
        landUse,
        amenities: amenities.slice(0, 5),
        adminBoundary,
        lat,
        lon,
      });
    } catch {
      setDetails({
        roads: [],
        village: 'Fetch failed',
        district: '',
        state: '',
        landUse: 'Unknown',
        amenities: [],
        adminBoundary: '',
        lat,
        lon,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !enabled) return;

    const onContextMenu = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      const { lat, lng } = e.latlng;

      // Place marker
      if (markerRef.current) map.removeLayer(markerRef.current);
      markerRef.current = L.circleMarker(e.latlng, {
        radius: 6,
        color: '#f59e0b',
        fillColor: '#f59e0b',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);

      fetchLandDetails(lat, lng);
    };

    // Use right-click for land details to avoid conflicting with drawing
    map.on('contextmenu', onContextMenu);
    return () => {
      map.off('contextmenu', onContextMenu);
    };
  }, [mapRef, enabled, fetchLandDetails]);

  const handleClose = () => {
    setVisible(false);
    setDetails(null);
    if (markerRef.current && mapRef.current) {
      mapRef.current.removeLayer(markerRef.current);
      markerRef.current = null;
    }
  };

  if (!visible) return null;

  return (
    <div className="absolute bottom-14 right-4 z-[1001] w-64 sm:w-72">
      <div className="glass-panel rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Info size={14} className="text-warning" />
            Land Details
          </h3>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={18} className="text-primary animate-spin" />
            <span className="text-xs text-muted-foreground ml-2">Fetching data...</span>
          </div>
        ) : details ? (
          <div className="space-y-2 text-[11px]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin size={12} className="text-warning shrink-0" />
              <span>{details.lat.toFixed(5)}, {details.lon.toFixed(5)}</span>
            </div>

            {details.village && (
              <div className="grid grid-cols-[70px_1fr] gap-1">
                <span className="text-muted-foreground">Village/Town</span>
                <span className="text-foreground">{details.village}</span>
              </div>
            )}
            {details.district && (
              <div className="grid grid-cols-[70px_1fr] gap-1">
                <span className="text-muted-foreground">District</span>
                <span className="text-foreground">{details.district}</span>
              </div>
            )}
            {details.state && (
              <div className="grid grid-cols-[70px_1fr] gap-1">
                <span className="text-muted-foreground">State</span>
                <span className="text-foreground">{details.state}</span>
              </div>
            )}
            <div className="grid grid-cols-[70px_1fr] gap-1">
              <span className="text-muted-foreground">Land Use</span>
              <span className="text-foreground capitalize">{details.landUse}</span>
            </div>
            {details.adminBoundary && (
              <div className="grid grid-cols-[70px_1fr] gap-1">
                <span className="text-muted-foreground">Admin Area</span>
                <span className="text-foreground">{details.adminBoundary}</span>
              </div>
            )}

            {details.roads.length > 0 && (
              <div className="pt-1 border-t border-border">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <Milestone size={11} /> <span>Nearby Roads</span>
                </div>
                {details.roads.map((r, i) => (
                  <p key={i} className="text-foreground pl-3">{r}</p>
                ))}
              </div>
            )}

            {details.amenities.length > 0 && (
              <div className="pt-1 border-t border-border">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <Building2 size={11} /> <span>Nearby Places</span>
                </div>
                {details.amenities.map((a, i) => (
                  <p key={i} className="text-foreground pl-3 capitalize">
                    {a.name} <span className="text-muted-foreground">({a.type})</span>
                  </p>
                ))}
              </div>
            )}

            <p className="text-[9px] text-muted-foreground pt-1 flex items-center gap-1">
              <TreePine size={10} />
              Data: OpenStreetMap &amp; Nominatim (right-click to inspect)
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
