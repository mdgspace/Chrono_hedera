import { createTheme } from '@mui/material/styles';
import { tokens } from './tokens';

export const chronoTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: tokens.colors.slate[950],
      paper: tokens.colors.slate[900],
    },
    primary: {
      main: tokens.colors.emerald[500],
      dark: tokens.colors.emerald[600],
      light: tokens.colors.emerald[400],
    },
    text: {
      primary: tokens.colors.slate[50],
      secondary: tokens.colors.slate[400],
      disabled: tokens.colors.slate[600],
    },
    success: {
      main: tokens.colors.state.safe,
    },
    warning: {
      main: tokens.colors.state.warning,
    },
    error: {
      main: tokens.colors.state.danger,
    },
    info: {
      main: tokens.colors.state.expiry, // Used for expiry semantics
    },
    divider: tokens.colors.slate[700],
  },
  typography: {
    fontFamily: tokens.typography.fontFamily.inter,
    h1: { fontSize: tokens.typography.scale['3xl'], fontWeight: 700, color: tokens.colors.slate[50] },
    h2: { fontSize: tokens.typography.scale['2xl'], fontWeight: 600, color: tokens.colors.slate[50] },
    h3: { fontSize: tokens.typography.scale.xl, fontWeight: 600, color: tokens.colors.slate[50] },
    h4: { fontSize: tokens.typography.scale.lg, fontWeight: 600, color: tokens.colors.slate[50] },
    body1: { fontSize: tokens.typography.scale.base, color: tokens.colors.slate[200] },
    body2: { fontSize: tokens.typography.scale.sm, color: tokens.colors.slate[400] },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: {
    borderRadius: parseInt(tokens.radius.md), // 10px default for components
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: tokens.colors.slate[900],
          backgroundImage: 'none',
          border: `1px solid ${tokens.colors.slate[700]}`,
          borderRadius: tokens.radius.lg,
          boxShadow: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.md,
          padding: '8px 16px',
        },
      },
      variants: [
        {
          props: { variant: 'contained', color: 'primary' },
          style: {
            backgroundColor: tokens.colors.emerald[500],
            color: tokens.colors.slate[50],
            '&:hover': {
              backgroundColor: tokens.colors.emerald[400],
            },
          },
        },
      ],
    },
  },
});
