import Foundation

class BackendService {
    static let shared = BackendService()
    
    private let baseURL = "http://localhost:8000/api"
    private var currentRequestId: String?
    
    // Hard-coded default user ID
    static let currentUserId = 1
    
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
    
    func fetchProjects(completion: @escaping (Result<[Project], Error>) -> Void) {
        guard let url = URL(string: "\(baseURL)/projects?user_id=\(BackendService.currentUserId)") else {
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
                    
                    // Use ISO8601 date decoder which handles various formats
                    let formatter = ISO8601DateFormatter()
                    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                    decoder.dateDecodingStrategy = .custom { decoder in
                        let container = try decoder.singleValueContainer()
                        let dateString = try container.decode(String.self)
                        
                        // Try ISO8601 first
                        if let date = formatter.date(from: dateString) {
                            return date
                        }
                        
                        // Fallback to custom format
                        let fallbackFormatter = DateFormatter()
                        fallbackFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'"
                        fallbackFormatter.timeZone = TimeZone(abbreviation: "UTC")
                        
                        if let date = fallbackFormatter.date(from: dateString) {
                            return date
                        }
                        
                        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot parse date: \(dateString)")
                    }
                    
                    let projects = try decoder.decode([Project].self, from: data)
                    completion(.success(projects))
                } catch {
                    print("🔍 JSON Decoding Error: \(error)")
                    if let jsonString = String(data: data, encoding: .utf8) {
                        print("📄 Raw JSON Response: \(jsonString)")
                    }
                    completion(.failure(error))
                }
            } else {
                completion(.failure(ServiceError.invalidResponse))
            }
        }.resume()
    }
    
    func fetchChats(for projectId: Int, completion: @escaping (Result<[AgentChat], Error>) -> Void) {
        guard let url = URL(string: "\(baseURL)/chats?project_id=\(projectId)") else {
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
                    
                    // Use the same date decoding strategy as projects
                    let formatter = ISO8601DateFormatter()
                    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                    decoder.dateDecodingStrategy = .custom { decoder in
                        let container = try decoder.singleValueContainer()
                        let dateString = try container.decode(String.self)
                        
                        if let date = formatter.date(from: dateString) {
                            return date
                        }
                        
                        let fallbackFormatter = DateFormatter()
                        fallbackFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'"
                        fallbackFormatter.timeZone = TimeZone(abbreviation: "UTC")
                        
                        if let date = fallbackFormatter.date(from: dateString) {
                            return date
                        }
                        
                        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot parse date: \(dateString)")
                    }
                    
                    let chats = try decoder.decode([AgentChat].self, from: data)
                    completion(.success(chats))
                } catch {
                    print("🔍 JSON Decoding Error for chats: \(error)")
                    if let jsonString = String(data: data, encoding: .utf8) {
                        print("📄 Raw JSON Response: \(jsonString)")
                    }
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

struct Project: Codable, Identifiable {
    let id: Int
    let name: String
    let description: String?
    let user_owner_id: Int
    let created_at: Date
    let updated_at: Date
    
    var emoji: String {
        // Generate consistent emoji based on project name
        let emojis = ["📱", "💻", "🌐", "🚀", "⚡", "🔧", "🎯", "💡", "🌟", "🔥"]
        let index = abs(name.hash) % emojis.count
        return emojis[index]
    }
}

struct AgentChat: Codable, Identifiable {
    let id: Int
    let name: String
    let project_id: Int
    let user_id: Int
    let status_id: Int
    let created_at: Date
    let updated_at: Date
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
