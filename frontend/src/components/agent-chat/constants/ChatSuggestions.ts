export const SUGGESTIONS_STYLE = {
    suggestions: {
        backgroundColor: null,
        list: {
            backgroundColor: 'var(--background-darker)',
            border: '1px solid var(--background)',
            borderRadius: 'calc(var(--radius) - 2px)',
            fontSize: 14,
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            marginTop: 4,
            maxHeight: 200,
        },
        item: {
            padding: '8px 12px',
            borderBottom: '1px solid var(--background)',
            color: 'var(--background-darker-foreground)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            '&focused': {
                backgroundColor: 'var(--secondary)',
                color: 'var(--muted-foreground)',
                borderBottom: '1px solid transparent',
            },
        },
    },
}