import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import styled from 'styled-components';

// Initialize mermaid with dark theme settings
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#fabd2f',
    primaryTextColor: '#ebdbb2',
    primaryBorderColor: '#fabd2f',
    lineColor: '#ebdbb2',
    secondaryColor: '#3c3836',
    tertiaryColor: '#504945',
    background: '#282828',
    mainBkg: '#3c3836',
    secondBkg: '#504945',
    nodeBorder: '#fabd2f',
    clusterBkg: '#3c3836',
    clusterBorder: '#504945',
    titleColor: '#fabd2f',
    edgeLabelBackground: '#282828',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis',
  },
});

const MermaidContainer = styled.div`
  margin: 1.5rem 0;
  padding: 1rem;
  background: ${({ theme }) => theme.colors.text[300]}15;
  border-radius: 6px;
  overflow-x: auto;

  svg {
    max-width: 100%;
    height: auto;
  }

  /* Override mermaid's inline styles for better theme integration */
  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    stroke: ${({ theme }) => theme.colors.primary} !important;
  }

  .edgePath .path {
    stroke: ${({ theme }) => theme.colors.text[200]} !important;
  }

  .label {
    color: ${({ theme }) => theme.colors.text[100]} !important;
  }
`;

const ErrorContainer = styled.div`
  color: ${({ theme }) => theme.colors.text[300]};
  padding: 1rem;
  background: ${({ theme }) => theme.colors.text[300]}10;
  border-left: 3px solid ${({ theme }) => theme.colors.text[300]};
  border-radius: 0 4px 4px 0;
  font-size: 0.9rem;
`;

interface MermaidProps {
  chart: string;
}

const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    const renderChart = async () => {
      if (!containerRef.current) return;

      try {
        // Clear previous content
        containerRef.current.innerHTML = '';
        setError(null);

        // Render the mermaid diagram
        const { svg } = await mermaid.render(idRef.current, chart);
        containerRef.current.innerHTML = svg;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to render diagram';
        setError(message);
        // Show the raw chart as fallback
        containerRef.current.innerHTML = `<pre><code>${chart}</code></pre>`;
      }
    };

    renderChart();
  }, [chart]);

  if (error) {
    return (
      <ErrorContainer>
        <div>Diagram rendering failed: {error}</div>
        <pre style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
          <code>{chart}</code>
        </pre>
      </ErrorContainer>
    );
  }

  return <MermaidContainer ref={containerRef} />;
};

export default Mermaid;
