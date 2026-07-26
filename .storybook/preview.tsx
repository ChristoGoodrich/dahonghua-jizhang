import React from 'react';
import type { Preview } from '@storybook/react';
import { ThemeProvider } from '@/theme/ThemeContext';

const preview: Preview = {
  decorators: [
    (Story) => (
      <ThemeProvider themeKey="default" dark={false}>
        <Story />
      </ThemeProvider>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
