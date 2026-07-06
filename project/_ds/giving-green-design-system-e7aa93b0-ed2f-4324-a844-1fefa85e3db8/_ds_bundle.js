/* @ds-bundle: {"format":4,"namespace":"GivingGreenDesignSystem_e7aa93","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Chip","sourcePath":"components/core/Chip.jsx"},{"name":"SearchInput","sourcePath":"components/core/SearchInput.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"ce51a84bc0be","components/core/Button.jsx":"4b8ff8b7ad50","components/core/Chip.jsx":"c2359f439754","components/core/SearchInput.jsx":"758b3b7acf6c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.GivingGreenDesignSystem_e7aa93 = window.GivingGreenDesignSystem_e7aa93 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
/** Small tag/label. variant="promo" = outlined pill (Top Pick, New for 2026).
 * variant="highlight" = bare text in Giving Red, no container (funding-gap callouts,
 * mirrors the Nike source's badge-sale-text with no background). */
function Badge({
  variant = 'promo',
  children
}) {
  if (variant === 'highlight') {
    return /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--text-caption-md)',
        color: 'var(--giving-red)'
      }
    }, children);
  }
  if (variant === 'achievement') {
    return /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--text-caption-sm)',
        color: 'var(--ink)',
        background: 'var(--gold-pale)',
        border: '1px solid var(--gold)',
        borderRadius: 'var(--radius-pill)',
        padding: '4px 12px',
        letterSpacing: 'var(--tracking-caption)',
        textTransform: 'uppercase'
      }
    }, children);
  }
  return /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-caption-sm)',
      color: 'var(--ink)',
      background: 'var(--white)',
      border: '1px solid var(--hairline)',
      borderRadius: 'var(--radius-pill)',
      padding: '4px 12px',
      letterSpacing: 'var(--tracking-caption)',
      textTransform: 'uppercase'
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
/** Giving Green pill button. Variants map 1:1 to the Nike source's
 * button-primary / button-secondary / button-outline-on-image / button-icon-circular. */
function Button({
  variant = 'primary',
  size = 'md',
  icon = null,
  disabled = false,
  onClick,
  children
}) {
  const base = {
    fontFamily: 'var(--font-text)',
    border: 'none',
    borderRadius: 'var(--radius-pill)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'transform .12s ease-out, opacity .12s ease-out, background .15s ease-out',
    opacity: disabled ? 0.45 : 1
  };
  const sizes = {
    lg: {
      font: 'var(--text-button-lg)',
      padding: '18px 36px',
      height: '56px'
    },
    md: {
      font: 'var(--text-button-md)',
      padding: '14px 28px',
      height: '48px'
    },
    sm: {
      font: 'var(--text-button-sm)',
      padding: '10px 20px',
      height: '40px'
    }
  };
  const variants = {
    primary: {
      background: 'var(--giving-red)',
      color: 'var(--white)'
    },
    secondary: {
      background: 'var(--cream-deep)',
      color: 'var(--ink)'
    },
    'outline-on-image': {
      background: 'var(--white)',
      color: 'var(--ink)'
    },
    icon: {
      background: 'var(--cream-deep)',
      color: 'var(--ink)',
      borderRadius: 'var(--radius-pill)',
      width: '40px',
      height: '40px',
      padding: 0
    }
  };
  const style = {
    ...base,
    ...sizes[size],
    ...variants[variant]
  };
  if (variant === 'icon') {
    return /*#__PURE__*/React.createElement("button", {
      style: style,
      disabled: disabled,
      onClick: onClick,
      "aria-label": typeof children === 'string' ? children : 'action'
    }, icon);
  }
  return /*#__PURE__*/React.createElement("button", {
    style: style,
    disabled: disabled,
    onClick: onClick
  }, icon, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Chip.jsx
try { (() => {
/** Filter chip — default outline, active fully inverts to Forest Green. */
function Chip({
  active = false,
  children,
  onClick
}) {
  const style = {
    fontFamily: 'var(--font-text)',
    font: 'var(--text-button-sm)',
    padding: '8px 16px',
    borderRadius: 'var(--radius-pill)',
    border: active ? 'none' : '1px solid var(--hairline)',
    background: active ? 'var(--forest-green)' : 'var(--white)',
    color: active ? 'var(--white)' : 'var(--ink)',
    cursor: 'pointer',
    transition: 'background .15s ease-out, color .15s ease-out'
  };
  return /*#__PURE__*/React.createElement("button", {
    style: style,
    onClick: onClick
  }, children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Chip.jsx", error: String((e && e.message) || e) }); }

// components/core/SearchInput.jsx
try { (() => {
/** Search pill — default and focused states, mirrors the source's search-pill. */
function SearchInput({
  placeholder = 'Search nonprofits…',
  value,
  onChange
}) {
  const [focused, setFocused] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      background: focused ? 'var(--white)' : 'var(--cream-deep)',
      border: focused ? '2px solid var(--forest-green)' : '2px solid transparent',
      boxShadow: focused ? '0 0 0 8px var(--cream-deep)' : 'none',
      borderRadius: 'var(--radius-md)',
      padding: '8px 16px',
      height: '40px',
      boxSizing: 'border-box',
      transition: 'box-shadow .15s ease-out, border-color .15s ease-out'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-mute)',
      font: 'var(--text-body-md)'
    }
  }, "\u2315"), /*#__PURE__*/React.createElement("input", {
    value: value,
    onChange: onChange,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    placeholder: placeholder,
    style: {
      border: 'none',
      outline: 'none',
      background: 'transparent',
      font: 'var(--text-body-md)',
      color: 'var(--ink)',
      flex: 1
    }
  }));
}
Object.assign(__ds_scope, { SearchInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/SearchInput.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.SearchInput = __ds_scope.SearchInput;

})();
