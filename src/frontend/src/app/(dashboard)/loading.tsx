export default function DashboardLoading(): React.JSX.Element {
  return (
    <div style={{ padding: '2rem 0' }}>
      <div
        style={{
          width: '32px',
          height: '32px',
          border: '3px solid var(--ct-border)',
          borderTopColor: 'var(--ct-accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
