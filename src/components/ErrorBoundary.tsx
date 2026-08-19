import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { store$ } from '@/store/ledger';
import { I18N, type Lang } from '@/i18n';

interface Props {
  children: React.ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // In production this could be wired to a crash-reporting service.
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const lang: Lang = store$.lang.get();
    const s = I18N[lang];

    return (
      <View style={styles.container}>
        <Text style={styles.title}>{s.errorTitle}</Text>
        <Text style={styles.message}>{s.errorMessage}</Text>
        {!!this.state.error?.message && (
          <Text style={styles.detail}>{this.state.error.message}</Text>
        )}
        <Pressable style={styles.button} onPress={this.handleReset} accessibilityRole="button">
          <Text style={styles.buttonText}>{s.errorRestart}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#D64545',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  detail: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#D64545',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
