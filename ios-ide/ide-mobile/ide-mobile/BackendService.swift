import Foundation

class BackendService {
    static let shared = BackendService()
    
    private let baseURL = "http://localhost:8000/api"
    private var currentRequestId: String?
    
    private init() {}
    
    func submitRequest(_ request: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard let url = URL(string: "\(baseURL)/requests") else {
            completion(.failure(ServiceError.invalidURL))
            return
        }
        
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let requestBody = ["request": request]
        
        do {
            urlRequest.httpBody = try JSONSerialization.data(withJSONObject: requestBody)
        } catch {
            completion(.failure(error))
            return
        }
        
        URLSession.shared.dataTask(with: urlRequest) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                completion(.failure(ServiceError.invalidResponse))
                return
            }
            
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let requestId = json["request_id"] as? String {
                self.currentRequestId = requestId
                completion(.success(()))
            } else {
                completion(.failure(ServiceError.invalidResponse))
            }
        }.resume()
    }
    
    func pollForCompletion(completion: @escaping (Result<Bool, Error>) -> Void) {
        guard let requestId = currentRequestId else {
            completion(.failure(ServiceError.noActiveRequest))
            return
        }
        
        guard let url = URL(string: "\(baseURL)/requests/\(requestId)/status") else {
            completion(.failure(ServiceError.invalidURL))
            return
        }
        
        URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                completion(.failure(ServiceError.invalidResponse))
                return
            }
            
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let ready = json["ready"] as? Bool {
                completion(.success(ready))
            } else {
                completion(.failure(ServiceError.invalidResponse))
            }
        }.resume()
    }
    
    func fetchTasks(completion: @escaping (Result<[Task], Error>) -> Void) {
        guard let requestId = currentRequestId else {
            completion(.failure(ServiceError.noActiveRequest))
            return
        }
        
        guard let url = URL(string: "\(baseURL)/requests/\(requestId)/tasks") else {
            completion(.failure(ServiceError.invalidURL))
            return
        }
        
        URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                completion(.failure(ServiceError.invalidResponse))
                return
            }
            
            if let data = data {
                do {
                    let decoder = JSONDecoder()
                    let tasksResponse = try decoder.decode(TasksResponse.self, from: data)
                    completion(.success(tasksResponse.tasks))
                } catch {
                    completion(.failure(error))
                }
            } else {
                completion(.failure(ServiceError.invalidResponse))
            }
        }.resume()
    }
}

enum ServiceError: Error {
    case invalidURL
    case invalidResponse
    case noActiveRequest
}

struct TasksResponse: Codable {
    let tasks: [Task]
}

struct Task: Codable, Identifiable {
    let id: String
    let name: String
    let status: TaskStatus
    let description: String?
    
    enum TaskStatus: String, Codable {
        case pending = "pending"
        case inProgress = "in_progress"
        case completed = "completed"
        case failed = "failed"
    }
}

extension Task.TaskStatus {
    var color: Color {
        switch self {
        case .pending:
            return .blue
        case .inProgress:
            return .orange
        case .completed:
            return .green
        case .failed:
            return .red
        }
    }
    
    var displayName: String {
        switch self {
        case .pending:
            return "Pending"
        case .inProgress:
            return "In Progress"
        case .completed:
            return "Completed"
        case .failed:
            return "Failed"
        }
    }
}

import SwiftUI
