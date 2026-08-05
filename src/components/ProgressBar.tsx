const ProgressBar = ({ percent, label }: { percent: number; label?: string }) => (
  <div>
    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
      <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${percent}%` }} />
    </div>
    {label && <p className="text-xs text-slate-400 mt-1 text-center">{label}</p>}
  </div>
);
export default ProgressBar;
