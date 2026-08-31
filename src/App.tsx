import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './show/context/AuthContext';
import { ShowRouter } from './show/ShowRouter';
import { ErrorBoundary } from './show/components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ShowRouter />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
