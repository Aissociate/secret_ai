import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './show/context/AuthContext';
import { ShowRouter } from './show/ShowRouter';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ShowRouter />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
