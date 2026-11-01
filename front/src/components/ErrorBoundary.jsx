import { Component } from 'react';
import { t } from '../services/i18n'

class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
            {t('error.occurred')}
          </p>
          <p style={{ fontSize: 12, marginTop: 4 }}>
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 12, padding: '6px 16px', border: '1px solid var(--border)',
              borderRadius: 6, background: 'var(--bg-secondary)', cursor: 'pointer',
              fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)'
            }}
          >
            {t('error.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
