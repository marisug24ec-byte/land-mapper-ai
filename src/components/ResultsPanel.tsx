import { Save, FileText, RotateCcw, Info, CheckCircle } from 'lucide-react';
import type { Measurement } from '../utils/mapHelpers';

interface ResultsPanelProps {
  measurement: Measurement;
  showDisclaimer: boolean;
  onToggleDisclaimer: () => void;
  onSave: () => void;
  onExport: () => void;
  onClear: () => void;
  showSaveSuccess: boolean;
}

export const ResultsPanel = ({
  measurement,
  showDisclaimer,
  onToggleDisclaimer,
  onSave,
  onExport,
  onClear,
  showSaveSuccess,
}: ResultsPanelProps) => {
  return (
    <div className="absolute top-20 right-4 z-[1100] w-56 sm:w-64">
      <div className="rounded-xl p-4 sm:p-5 space-y-3" style={{ background: 'hsl(222 22% 12% / 0.95)', backdropFilter: 'blur(20px)', border: '1px solid hsl(220 15% 22% / 0.6)', boxShadow: '0 12px 40px hsl(0 0% 0% / 0.5), 0 0 0 1px hsl(220 15% 22% / 0.3)', borderRadius: '1rem' }}>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse-glow inline-block" />
          Site Analytics
        </h2>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <span className="text-muted-foreground">Area (sq.m)</span>
            <span className="text-foreground font-mono text-right">{measurement.areaSqm.toFixed(2)}</span>
            <span className="text-muted-foreground">Area (Acres)</span>
            <span className="text-foreground font-mono text-right">{measurement.areaAcres.toFixed(4)}</span>
            <span className="text-muted-foreground">Area (Ha)</span>
            <span className="text-foreground font-mono text-right">{measurement.areaHectares.toFixed(4)}</span>
            <span className="text-muted-foreground">Perimeter (m)</span>
            <span className="text-foreground font-mono text-right">{measurement.perimeterM.toFixed(2)}</span>
          </div>

          <div className="pt-1">
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-muted-foreground">Confidence</span>
              <span className="text-primary font-semibold">{measurement.confidence}%</span>
            </div>
            <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${measurement.confidence}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-1.5 pt-1">
          <button
            onClick={onSave}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
          >
            {showSaveSuccess ? <CheckCircle size={14} /> : <Save size={14} />}
            {showSaveSuccess ? 'Saved!' : 'Save'}
          </button>
          <button
            onClick={onExport}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <FileText size={14} />
            PDF
          </button>
          <button
            onClick={onClear}
            className="flex items-center justify-center px-2 py-1.5 rounded-lg bg-destructive/20 text-destructive text-xs font-medium hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            <RotateCcw size={14} />
          </button>
        </div>

        <button
          onClick={onToggleDisclaimer}
          className="w-full flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors pt-1"
        >
          <Info size={12} />
          <span>Accuracy &amp; Limitations</span>
        </button>

        {showDisclaimer && (
          <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1 border-t border-border pt-2">
            <p>⚠ This is <strong>NOT</strong> a legal land survey.</p>
            <p>⚠ No government land records are used.</p>
            <p>⚠ Accuracy depends on satellite image quality.</p>
            <p>✓ Best with clear edges: roads, rivers, vegetation.</p>
            <p>⚠ Poor results in dense urban areas.</p>
            <p className="text-primary/70 pt-1">For official surveys, consult a licensed surveyor.</p>
          </div>
        )}
      </div>
    </div>
  );
};
